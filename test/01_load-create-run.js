/*
 * Tests the basics of successful loading the nodes into Node-RED
 */

"use strict";

var http = require('http'),
    path = require('path'),
    EventEmitter = require('events'),
    express = require('express'),
    request = require('request'),
    delay = require('delay');
var test = require('tape');

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
const DELAY_AFTER_START = 2500;

var before = test;
var server;
var RED;
var nodes = {};
var testFlow;

const SENSOR_NODE = 'wirelesstag';
const ALL_NODE = 'wirelesstag-all';
const CONFIG_NODE = 'wirelesstag-config';
const NODE_TYPES = [CONFIG_NODE, SENSOR_NODE, ALL_NODE];

function invokeAdminAPI(methodName, reqBody, httpMethod) {
    if (! httpMethod) httpMethod = 'GET';
    if (httpMethod === 'GET' && reqBody) {
        methodName += '/' + reqBody;
        reqBody = undefined;
    }
    let uriPath = `${settings.httpAdminRoot}/${methodName}`;
    let apiCall = new Promise((resolve, reject) => {
        request({
            method: httpMethod,
            uri: `http://${LISTEN_IF}:${LISTEN_PORT}${uriPath}`,
            json: true,
            jar: true,
            body: reqBody
        }, function (error, response, body) {
            if (error || response.statusCode > 204) {
                console.error(body);
                if (! error) error = new Error("status " + response.statusCode);
                return reject(error);
            }
            resolve(body);
        });
    });
    return apiCall;
}

function failAndEnd(t) {
    return (err) => {
        t.fail(err);
        t.end();
    };
}

test.onFinish(function() {

    function closeUp() {
        let prom = testFlow ? RED.nodes.removeFlow(testFlow) : Promise.resolve();
        if (RED) {
            prom = prom.then(() => RED.stop());
        } else {
            prom = prom.then(() => {
                NODE_TYPES.forEach((nt) => {
                    if (nodes[nt] && nodes[nt].close) nodes[nt].close();
                });
            });
        }
        prom.then(() => {
            if (! server) return;
            return new Promise((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve(server)));
            });
        }).catch((e) => {
            console.error("stopping Node-RED failed:");
            console.error(e.stack ? e.stack : e);
        });
    }

    let cloud = nodes[CONFIG_NODE];
    if (cloud && cloud.platform && cloud.platform.connecting) {
        cloud.platform.on('connect', closeUp);
    } else {
        closeUp();
    }
});

before('can create and initialize Node-RED runtime', function(t) {
    // t.plan(4);

    RED = require('node-red');
    t.ok(RED, 'instantiates Node-RED runtime');

    let app = express();
    // app.get('/flows', (req, res) => res.send("Test server"));
    server = http.createServer(app);
    RED.init(server, settings);
    t.ok(RED.httpAdmin, 'creates HTTP Admin API');
    t.ok(RED.httpNode, 'creates HTTP Node API');

    // serve the admin and nodes http APIs
    app.use(settings.httpAdminRoot, RED.httpAdmin);
    app.use(settings.httpNodeRoot, RED.httpNode);
    server.listen(LISTEN_PORT, LISTEN_IF);

    RED.start().then(() => {
        t.pass('starts Node-RED runtime');
        t.comment('delaying briefly so flows can start');
    }).then(delay(DELAY_AFTER_START)).then(t.end).catch(failAndEnd(t));
});

test('our nodes are registered', function(t) {
    t.plan(9);
    NODE_TYPES.forEach((nt) => {
        let Node = RED.nodes.getType(nt);
        t.ok(Node, nt + ' is registered');
        t.equal(typeof Node,
                'function',
                'type is (constructor) function');
        t.ok(Node.prototype instanceof EventEmitter,
             'type inherits from event emitter');
    });
    t.end();
});

test('our nodes can be created and added to a flow', function(t) {

    NODE_TYPES.forEach((nt) => {
        let conf = { id: RED.util.generateId(), type: nt };
        if (nt === CONFIG_NODE) {
            conf.credentials = {
                username: '$(WIRELESSTAG_API_USER)',
                password: '$(WIRELESSTAG_API_PASSWORD)'
            };
        } else {
            conf.x = conf.y = 0;
            conf.cloud = nodes[CONFIG_NODE].id;
            conf.wires = [];
        }
        nodes[nt] = conf;
    });
    let flow = {
        label: "Test Flow",
        nodes: [nodes[SENSOR_NODE], nodes[ALL_NODE]],
        configs: [nodes[CONFIG_NODE]]
    };
    invokeAdminAPI('flow', flow, 'POST').then((result) => {
        t.ok(result, 'successfully created flow with our nodes');
        t.ok(result.id, 'received ID of newly created flow');
        testFlow = result.id;
        return invokeAdminAPI('flow', testFlow);
    }).then((result) => {
        t.equal(result.id, testFlow, 'can retrieve the created flow');
        t.equal(result.nodes.length, 2, 'new flow has 2 nodes');
        t.equal(result.configs.length, 1, 'new flow has 1 config node');
        t.equal(result.configs[0].type, 'wirelesstag-config',
                'config node is of our type');
        nodes[result.configs[0].type] = result.configs[0];
        for (let i = 0; i < result.nodes.length; i++) {
            t.equal(result.nodes[i].cloud,
                    result.configs[0].id,
                    `node ${i} references correct cloud config`);
            t.equal(result.nodes[i].type.indexOf('wirelesstag'), 0,
                    `node ${i} is of one of the types we define`);
            nodes[result.nodes[i].type] = result.nodes[i];
        }
    }).then(t.end).catch(failAndEnd(t));
});

test('once added to a flow nodes can be retrieved from runtime', function(t) {
    for (let nt in nodes) {
        if (nodes[nt].id) {
            let n = RED.nodes.getNode(nodes[nt].id);
            t.ok(n, `can obtain ${nt} node object from RED runtime`);
            if (n) {
                t.equal(n.id, nodes[nt].id, 'it has matching ID');
                t.equal(n.type, nodes[nt].type, 'it has matching type');
                nodes[nt] = n;
                let Node = RED.nodes.getType(nt);
                t.ok(n instanceof Node, 'it is instance of constructor');
            } else {
                t.skip('cannot test retrieved node object');
            }
        } else {
            t.skip('missing node object for ' + nt);
        }
    }
    t.end();
});
