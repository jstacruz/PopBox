//
// Copyright (c) Telefonica I+D. All rights reserved.
//
//


var config = require('./config.js');
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;

var path = require('path');
var log = require('PDITCLogger');
var logger = log.newLogger();
logger.prefix = path.basename(module.filename,'.js');

var prefixer = require('./prefixer') ;
var sendrender = require('./sendrender') ;

if (config.cluster.numcpus >= 0 && config.cluster.numcpus < numCPUs) {
    numCPUs = config.cluster.numcpus;
    logger.info('numCPUs='+numCPUs);
}


if (cluster.isMaster && numCPUs !== 0) {
    // Fork workers.
    for (var i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('death', function (worker) {
        'use strict';
        logger.warning('worker ' + worker.pid + ' died');
    });
} else {
    logger.debug('cluster worker', cluster);

    var fs = require('fs');
    var express = require('express');
    var logic = require('./agent_logic');
    var async = require('async');
    var emitter = require('./emitter_module').getEmitter();
    var evLsnr = require('./ev_lsnr');
    var cbLsnr = require('./ev_callback_lsnr');

    var servers = [];
    var app = express.createServer();
    app.prefix = "UNSEC:";
    app.port = config.agent.port;
    servers.push(app);

    logger.info("config.enableSecure", config.enableSecure);
    if (config.enableSecure === true ||  config.enableSecure === "true" || config.enableSecure === 1) {
        var options = {
            key:fs.readFileSync('./PopBox/utils/server.key'),
            cert:fs.readFileSync('./PopBox/utils/server.crt')
        }
        var appSec = express.createServer(options);
        appSec.prefix = "SEC:";
        appSec.port = Number(config.agent.port) + 1;

        servers.push(appSec);
    }

    servers.forEach(function (server) {
        server.use(express.query());
        server.use(express.bodyParser());
        server.use(express.limit("1mb"));
        server.use(prefixer.prefixer(server.prefix));
        server.use(sendrender.sendRender());
        server.use(express.static(__dirname));
        server.use(express.directory(__dirname));

        server.del('/trans/:id_trans', logic.deleteTrans);
        //app.get('/trans/:id_trans/state/:state?', logic.transState);
        server.get('/trans/:id_trans', logic.transMeta);
        server.put('/trans/:id_trans', logic.putTransMeta);
        server.post('/trans/:id_trans/payload', logic.payloadTrans);
        server.post('/trans/:id_trans/expirationDate', logic.expirationDate);
        server.post('/trans/:id_trans/callback', logic.callbackTrans);
        server.post('/trans', logic.postTrans);
        server.get('/queue/:id', logic.getQueue);
        server.post('/queue/:id/pop', logic.popQueue);
    });


//Add subscribers
    async.parallel([evLsnr.init(emitter), cbLsnr.init(emitter)],
        function onSubscribed() {
            'use strict';
            // logger.debug('onSubscribed()', []);
            servers.forEach(function (server) {
                server.listen(server.port);
            });
        });
   /* servers.forEach(function (server) {
        server.listen(server.port);
    });*/
}

/*
process.on('uncaughtException', function onUncaughtException (err) {
    'use strict';
    logger.warning('onUncaughtException', err);
});
 */



