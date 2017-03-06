/*
 * Tests the basics of successful loading the nodes into Node-RED
 */

"use strict";

var EventEmitter = require('events'),
    embeddedStart = require('node-red-embedded-start');
var test = require('tape'),
    fixture = require('./fixture');

const FLOWS_TIMEOUT = 5000;

var before = test;
var RED;
var nodes = {};
var testFlow;

const SENSOR_NODE = 'wirelesstag';
const ALL_NODE = 'wirelesstag-all';
const CONFIG_NODE = 'wirelesstag-config';
const NODE_TYPES = [CONFIG_NODE, SENSOR_NODE, ALL_NODE];

test.onFinish(function() {

    let cloud = nodes[CONFIG_NODE];
    if (cloud && cloud.platform && cloud.platform.connecting) {
        cloud.platform.once('connect', () => fixture.closeUp(RED, testFlow, nodes));
    } else {
        fixture.closeUp(RED, testFlow, nodes);
    }
});

before('can create and initialize Node-RED runtime', function(t) {
    t.plan(3);

    RED = fixture.setup();
    t.ok(RED, 'instantiates Node-RED runtime');

    RED.start().then((result) => {
        t.pass('starts Node-RED runtime');
        return embeddedStart(RED, FLOWS_TIMEOUT, result);
    }).then(() => t.pass("flows started")).catch(fixture.failAndEnd(t));
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
    t.plan(9);

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
    RED.nodes.addFlow(flow).then((id) => {
        t.ok(id, 'successfully created flow with our nodes');
        testFlow = id;
        return RED.nodes.getFlow(testFlow);
    }).then((result) => {
        t.equal(result.id, testFlow, 'can retrieve the created flow');
        t.equal(result.nodes.length, 2, 'new flow has 2 nodes');
        t.equal(result.configs.length, 1, 'new flow has 1 config node');

        t.equal(result.configs[0].type, 'wirelesstag-config',
                'config node is of our type');
        nodes[result.configs[0].type] = result.configs[0];

        for (let i = 0; i < result.nodes.length; i++) {
            nodes[result.nodes[i].type] = result.nodes[i];
            t.equal(result.nodes[i].cloud,
                    result.configs[0].id,
                    `node ${i} references correct cloud config`);
            t.equal(result.nodes[i].type.indexOf('wirelesstag'), 0,
                    `node ${i} is of one of the types we define`);
        }
    }).then(t.end).catch(fixture.failAndEnd(t));
});

test('once added to a flow nodes can be retrieved from runtime', function(t) {
    t.plan(12);

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
