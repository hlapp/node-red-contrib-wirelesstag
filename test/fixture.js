"use strict";

var http = require('http'),
    path = require('path'),
    express = require('express');

const restPrefix = require('crypto').randomBytes(8).toString('hex');
const settings = {
    httpAdminRoot: `/${restPrefix}/red`,
    httpNodeRoot: `/${restPrefix}/node`,
    functionGlobalContext: {},
    disableEditor: true,
    userDir: path.join(__dirname, '.node-red'),
    nodesDir: path.join(__dirname, '..'),
    logging: {
        console: {
            level: process.env.NODE_RED_LOGLEVEL || "info"
        }
    }
};
const LISTEN_PORT = process.env.PORT || 8080;
const LISTEN_IF = "127.0.0.1";

module.exports = {
    failAndEnd: function (t) {
        return (err) => {
            if (err.stack) console.error(err.stack);
            t.fail(err);
            t.end();
        };
    },
    closeUp: function (RED, flow, nodes) {
        let prom = flow ? RED.nodes.removeFlow(flow) : Promise.resolve();
        if (RED) {
            prom = prom.then(() => RED.stop());
        } else {
            prom = prom.then(() => {
                nodes.forEach((n) => {
                    if (n && n.close) n.close();
                });
            });
        }
        prom.then(() => {
            if (! RED.server) return;
            let server = RED.server;
            return new Promise((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve(server)));
            });
        }).catch((e) => {
            console.error("stopping Node-RED failed:");
            console.error(e.stack ? e.stack : e);
        });
    },
    createNodeDescriptor: function(RED, nodeType, confNodeId) {
        let conf = { id: RED.util.generateId(), type: nodeType };
        if (confNodeId) {
            conf.x = conf.y = 0;
            conf.cloud = confNodeId;
            conf.wires = [];
        } else {
            conf.credentials = {
                username: '$(WIRELESSTAG_API_USER)',
                password: '$(WIRELESSTAG_API_PASSWORD)'
            };
        }
        return conf;
    },
    setup: function() {
        let RED = require('node-red');

        let app = express();
        let server = http.createServer(app);
        RED.init(server, settings);

        // serve the admin and nodes http APIs
        app.use(settings.httpAdminRoot, RED.httpAdmin);
        app.use(settings.httpNodeRoot, RED.httpNode);
        server.listen(LISTEN_PORT, LISTEN_IF);

        return RED;
    }
};
