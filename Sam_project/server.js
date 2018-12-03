var express = require('express');
var session = require('cookie-session');
var bodyParser = require('body-parser');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectID;
var assert = require('assert');
var url  = require('url');
var fs = require('fs');
var formidable = require('formidable');
var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
var app = express();
var mongourl = 'mongodb://samli511:Delaynomore1@ds139072.mlab.com:39072/restaurantapp';
var ensureLogin = require('connect-ensure-login')
app.set('view engine','ejs');

passport.serializeUser(function(user, cb) {
    cb(null, user.userid);
});

passport.deserializeUser(function(id, cb) {
    MongoClient.connect(mongourl, function(err, db) {
        db.collection('appUsers').findOne({userid:id}, function (err, user) {
            if (err) {
                return cb(err);
            }
            cb(null, user);
        });
    });
});

passport.use('local',new LocalStrategy(
    function(userid, password, done) {
        MongoClient.connect(mongourl, function(err, db) {
            db.collection('appUsers').findOne({userid: userid},function(err,user) {
                assert.equal(err,null);
                db.close();
                if (err) {
                    return done(err);
                }
                if (user===null) {
                    return done(null, false, {message: 'Incorrect username.'});
                }
                if (user.password!==password) {
                    return done(null, false, {message: 'Incorrect password.'});
                }
                return done(null, user);
            });
        });
    }
));

var SECRETKEY1 = 'Chan Chun Kit Ivan';
var SECRETKEY2 = 'Lee Ho Lam';

app.use(session({
    name: 'session',
    keys: [SECRETKEY1,SECRETKEY2]
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/css', express.static('css'));
app.use(passport.initialize());
app.use(passport.session());

app.get('/',ensureLogin.ensureLoggedIn(),function(req,res) {
    MongoClient.connect(mongourl, function(err, db) {
        assert.equal(err,null);
        findRestaurants(db,{},20,function(restaurants) {
            db.close();
            res.status(200);
            res.render('index',{restaurants:restaurants});
        });
    });
});

app.get('/display',ensureLogin.ensureLoggedIn(),function(req,res) {
    var parsedURL = url.parse(req.url,true);
    var queryAsObject = parsedURL.query;
    var backToIndex = (!(queryAsObject.backToIndex === null || queryAsObject.backToIndex === undefined));
    MongoClient.connect(mongourl, function(err, db) {
        assert.equal(err,null);
        db.collection('restaurants').
        findOne({_id: ObjectId(queryAsObject._id)},function(err,doc) {
            assert.equal(err,null);
            checkRated(db,queryAsObject._id,req.user.userid,function(callback){
                db.close();
                if(callback!==false){
                    res.render('display',{restaurant:doc,user:req.user.userid,rated:true,score:callback.grades[0].score,backToIndex:backToIndex});
                }else{
                    res.render('display',{restaurant:doc,user:req.user.userid,rated:false,score:false,backToIndex:backToIndex});
                }
            });
        });
    });
});

app.get('/filtering',ensureLogin.ensureLoggedIn(),function(req,res) {
    res.render('filtering',{});
});

app.post('/filtering',function(req,res) {
    var criteria={};
    for(key in req.body){
        if(req.body[key]!==''){
            switch(key){
                case "street": case "building": case "zipcode":
                    criteria['address.'+key] = new RegExp(req.body[key]);
                    break;
                default:
                    criteria[key] =  new RegExp(req.body[key]);
            }
        }
    }
    MongoClient.connect(mongourl, function(err, db) {
        assert.equal(err,null);
        findRestaurants(db,criteria,null,function(restaurants) {
            db.close();
            res.status(200);
            res.render('index',{restaurants:restaurants});
        });
    });
});

app.get('/edit',ensureLogin.ensureLoggedIn(),function(req,res) {
    var parsedURL = url.parse(req.url,true);
    var queryAsObject = parsedURL.query;
    if(queryAsObject.creator !== req.user.userid){
        alert("You are not allowed to edit this restaurant!");
        res.redirect("/");
    }
    var resObj = {
        _id: (queryAsObject._id===null?"":queryAsObject._id),
        building:(queryAsObject.building===null?"":queryAsObject.building),
        street:(queryAsObject.street===null?"":queryAsObject.street),
        zipcode:(queryAsObject.zipcode===null?"":queryAsObject.zipcode),
        name: queryAsObject.name,
        borough: queryAsObject.borough,
        cuisine: queryAsObject.cuisine,
        coord : [queryAsObject.lat,queryAsObject.lng]
    };
    res.render('edit',{restaurant:resObj});
});

app.post('/edit',function(req,res) {
    MongoClient.connect(mongourl,function(err,db) {
        assert.equal(err,null);
        var criteria = {};
        criteria['_id'] = ObjectId(req.body._id);
        var new_r = {
            address: {
                building:(req.body.building===null?"":req.body.building),
                street:(req.body.street===null?"":req.body.street),
                zipcode:(req.body.zipcode===null?"":req.body.zipcode),
                coord:[req.body.lat,req.body.lng]
            },
            name: req.body.name,
            borough: req.body.borough,
            cuisine: req.body.cuisine
        };
        updateRestaurant(db,criteria,new_r,function(result) {
            db.close();
            res.redirect('/display?_id='+req.body._id+'&backToIndex=true');
        });
    });
});

app.post('/delete',function(req,res) {
    var criteria = {
        _id : ObjectId(req.body._id)
    };
    MongoClient.connect(mongourl,function(err,db) {
        assert.equal(err,null);
        deleteRestaurant(db,criteria,function(result) {
            db.close();
            res.redirect("/");
        });
    });
});

app.post('/rate',function(req,res) {
    var criteria = {
        _id : ObjectId(req.body._id)
    };
    MongoClient.connect(mongourl,function(err,db) {
        assert.equal(err,null);
        db.collection('restaurants').update(
            { _id: ObjectId(req.body._id) },
            { $push:
                { grades:
                    {
                        userid:req.user.userid,
                        score:req.body.score
                    }
                }
            },function(err,result) {
                assert.equal(err, null);
                res.redirect('/display?_id='+req.body._id+'&backToIndex=true');
            }

        )
    });
});

app.get('/login',function(req,res) {
    res.render('login',{});
});

app.post('/login',
    passport.authenticate('local', { successRedirect: '/',
        failureRedirect: '/login'})
);

app.get('/register',function(req,res) {
    res.render('register',{});
});

app.post('/register',function(req,res) {
    MongoClient.connect(mongourl, function(err, db) {
        assert.equal(err,null);
        userRegister(db,req.body.userid,req.body.password,function(result) {
            db.close();
            res.redirect('/');
        });
    });
});

app.get('/create',ensureLogin.ensureLoggedIn(),function(req,res) {
    var creator = req.user.userid;
    res.render('create',{creator:creator});
});

app.post('/create',function(req,res) {
    var dataArray = {};
    var address = {};
    var new_r = {};
    var form = new formidable.IncomingForm();
    form.parse(req, function (err, fields, files) {
        dataArray['creator'] = fields.creator;
        dataArray['name'] = fields.name;
        dataArray['borough'] = fields.borough;
        dataArray['cuisine'] = fields.cuisine;
        dataArray['street'] = fields.street;
        dataArray['building'] = fields.building;
        dataArray['zipcode'] = fields.zipcode;
        dataArray['coord'] = [parseFloat(fields.lat),parseFloat(fields.lng)];
        var filename = files.filetoupload.path;
        var mimetype = files.filetoupload.type;
        if(files.filetoupload!==undefined && filename.substring(filename.lastIndexOf('.') +1)=="pdf"){
            fs.readFile(filename, function(err,data) {
                dataArray['mimetype'] = mimetype;
                dataArray['image'] = new Buffer(data).toString('base64');
                for(key in dataArray){
                    if(dataArray[key]!==''){
                        switch(key){
                            case "street": case "building": case "zipcode": case "coord":
                            address[key] = dataArray[key];
                            break;
                            default:
                                new_r[key] = dataArray[key];
                        }
                    }
                }
                if (address!==null&&address!=={}) {
                    new_r['address'] = address;
                }

                MongoClient.connect(mongourl,function(err,db) {
                    assert.equal(err,null);
                    insertRestaurant(db,new_r,function(id) {
                        db.close();
                        res.redirect('/display?_id='+id+'&backToIndex=true');
                    });
                });
            })
        }else{
            for(key in dataArray){
                if(dataArray[key]!==''){
                    switch(key){
                        case "street": case "building": case "zipcode": case "coord":
                        address[key] = dataArray[key];
                        break;
                        default:
                            new_r[key] = dataArray[key];
                    }
                }
            }
            if (address!==null&&address!=={}) {
                new_r['address'] = address;
            }

            MongoClient.connect(mongourl,function(err,db) {
                assert.equal(err,null);
                insertRestaurant(db,new_r,function(id) {
                    db.close();
                    res.redirect('/display?_id='+id);
                });
            });
        }


    });
});

app.get('/logout',function(req,res) {
    req.logout();
    res.redirect('/');
});

app.post('/api/restaurant/create',function(req,res){
    var inObj = req.body;
    var resObj;
    MongoClient.connect(mongourl,function(err,db) {
        assert.equal(err,null);
        insertRestaurant(db,inObj,function(id) {
            db.close();
            if(id!==undefined||id!==null){
                resObj = {
                    status : "ok",
                    _id: id
                };
                res.end(JSON.stringify(resObj));
            }else{
                resObj = {
                    status : "failed"
                };
                res.end(JSON.stringify(resObj));
            }
        });
    });
});

app.get('/api/restaurant/read/:criteria/:criValue',function(req,res){
    var criStr = req.params.criteria;
    var criValue = req.params.criValue;
    var criObj;
    switch(criStr){
        case "name":
            criObj = {"name":criValue};
            break;
        case "borough":
            criObj = {"borough":criValue};
            break;
        case "cuisine":
            criObj = {"cuisine":criValue};
            break;
        default:
            res.end("Invalid request");
    }
    MongoClient.connect(mongourl, function(err, db) {
        assert.equal(err,null);
        findRestaurants(db,criObj,null,function(restaurants) {
            db.close();
            res.writeHead(200, {"Content-Type": "text/json"});
            res.end(JSON.stringify(restaurants,null,4));
        });
    });
});

app.listen(process.env.PORT || 8001);

function findRestaurants(db,criteria,limit,callback) {
    var restaurants = [];
    if(limit!==null){
        cursor = db.collection('restaurants').find(criteria).limit(limit);
    }else{
        cursor = db.collection('restaurants').find(criteria);
    }
    cursor.each(function(err, doc) {
        assert.equal(err, null);
        if (doc != null) {
            restaurants.push(doc);
        } else {
            callback(restaurants);
        }
    });
}

function userRegister(db,userid,password,callback) {
    db.collection('appUsers').findOne({userid: userid},function(err,doc) {
        assert.equal(err,null);
        if(doc===null){
            db.collection('appUsers').insert(
                {
                    userid: userid,
                    password: password
                }, function(err, result) {
                    assert.equal(err,null);
                    callback(true);
                }
            )
        }else{
            callback(false);
        }
    });
}

function insertRestaurant(db,r,callback) {
    db.collection('restaurants').insertOne(r,function(err,result) {
        assert.equal(err,null);
        callback(r._id);
    });
}

function updateRestaurant(db,criteria,newValues,callback) {
    db.collection('restaurants').updateOne(
        criteria,{$set: newValues},function(err,result) {
            assert.equal(err,null);
            callback(result);
        });
}

function deleteRestaurant(db,criteria,callback) {
    db.collection('restaurants').remove(criteria,function(err,result) {
        assert.equal(err,null);
        callback(result);
    });
}

function checkRated(db,objId,userId,callback) {
    db.collection('restaurants').findOne({
        "_id": ObjectId(objId),
        grades: {$elemMatch: {userid: userId}}
    },function(err, doc) {
        if (doc == null) {
            callback(false);
        } else {
            callback(doc);
        }
    });
}
