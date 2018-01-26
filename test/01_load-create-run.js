/*
 * Tests the basics of successful loading the nodes into Node-RED
 */

"use strict";

var EventEmitter = require('events'),
    sinon = require('sinon'),
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
    t.plan(11);

    nodes[CONFIG_NODE] = fixture.createNodeDescriptor(RED, CONFIG_NODE);
    for (let nt of NODE_TYPES) {
        if (nt === CONFIG_NODE) continue;
        nodes[nt] = fixture.createNodeDescriptor(RED, nt, nodes[CONFIG_NODE].id);
    }
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
            t.equal(result.nodes[i].id, nodes[result.nodes[i].type].id,
                    `node ${i} has correct ID`);
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
    t.plan(16);

    for (let nt in nodes) {
        if (! nodes[nt].id) {
            t.skip('missing node object for ' + nt);
            continue;
        }
        let n = RED.nodes.getNode(nodes[nt].id);
        t.ok(n, `can obtain ${nt} node object from RED runtime`);
        if (! n) {
            t.skip('cannot test retrieved node object');
            continue;
        }
        t.equal(n.id, nodes[nt].id, 'it has matching ID');
        t.equal(n.type, nodes[nt].type, 'it has matching type');
        if (nt !== CONFIG_NODE) {
            t.equal(typeof n.debug, "function", 'has debug() log method');
            t.ok(n.config, 'has config property with value');
        }
        nodes[nt] = n;
        let Node = RED.nodes.getType(nt);
        t.ok(n instanceof Node, 'it is instance of constructor');
    }
    t.end();
});

test('connects to cloud and starts IO for our nodes', function(t) {
    t.plan(44);

    let nodeTypes = [SENSOR_NODE, ALL_NODE];
    let startIOspies = {}, sendSpies = {};
    nodeTypes.forEach((nt) => {
        startIOspies[nt] = sinon.spy(nodes[nt], "startIO");
        sendSpies[nt] = sinon.spy(nodes[nt], "send");
    });

    function testMsg(msg, tag, tt) {
        tt.equal(typeof msg.tagManager, 'object', 'message has tagManager object');
        ['mac', 'name'].forEach((k) => {
            tt.equal(msg.tagManager[k],
                     tag.wirelessTagManager[k],
                     `property "${k}" of msg.tagManager is correct`);
        });
        tt.equal(typeof msg.tag, 'object', 'message has tag object');
        ['name', 'uuid', 'slaveId'].forEach((k) => {
            tt.equal(msg.tag[k], tag[k], `property "${k}" of msg.tag is correct`);
        });
        let sensor = tag[msg.payload.sensor + 'Sensor'];
        tt.ok(sensor, 'payload references valid sensor of the tag');
        tt.equal(msg.payload.reading, sensor.reading,
                 'payload gives correct reading');
        tt.equal(msg.payload.eventState, sensor.eventState,
                 'payload gives correct event state');
        tt.equal(msg.payload.armed, sensor.isArmed(),
                 'payload gives correct armed state');
        let topicParts = msg.topic.split("/");
        tt.equal(topicParts.length, 3,
                 'topic consists of 3 elements separated by "/"');
        tt.equal(topicParts[0], tag.wirelessTagManager.mac,
                 'first element is tag manager');
        tt.equal(topicParts[1], tag.slaveId.toString(),
                 'second element is tag (slave ID)');
        tt.equal(topicParts[2], sensor.sensorType,
                 'third element is sensor type');
    }

    function onConnect(platform) {
        t.pass('is connected to cloud');
        nodeTypes.forEach((nt) => {
            t.ok(startIOspies[nt].calledOnce, 'startIO() called for ' + nt);
            t.ok(sendSpies[nt].notCalled, 'send() not called for ' + nt);
        });
        platform.discoverTags().then((tags) => {
            tags = tags.filter((tag) => tag.isPhysicalTag());
            t.ok(tags.length > 0, 'have one or more tags to test');
            let tag = tags[0];
            let sensorNode = nodes[SENSOR_NODE];
            sensorNode.config.tagmanager = tag.wirelessTagManager.mac;
            sensorNode.config.tag = tag.uuid;
            sensorNode.config.sensor = "temp"; // every tag should have temp
            return sensorNode.findTag().then((foundTag) => {
                t.ok(foundTag, 'can find tag through sensor node');
                t.equal(foundTag.uuid, tag.uuid, 'finds the correct tag');
                return foundTag.discoverSensors().then((sensors) => {
                    t.equal(sensors.length, foundTag.eachSensor().length,
                            'finds each of the tag\'s sensors');
                    sensorNode.startIO();
                    return nodes[ALL_NODE].sendData(tag);
                });
            });
        }).then((tag) => {
            t.ok(tag, 'sends data for ' + ALL_NODE);
            t.equal(sendSpies[SENSOR_NODE].callCount, 1,
                    'one message sent for ' + SENSOR_NODE);
            t.equal(sendSpies[ALL_NODE].callCount, tag.eachSensor().length,
                    'one message sent for each sensor for ' + ALL_NODE);
            t.comment(`message properties for ${SENSOR_NODE}:`);
            let msg = sendSpies[SENSOR_NODE].args[0][0];
            testMsg(msg, tag, t);
            t.comment(`message properties for ${ALL_NODE}, temp sensor:`);
            msg = sendSpies[ALL_NODE].args.map((args) => args[0]
            ).filter((msgArg) => msgArg.payload.sensor === "temp");
            testMsg(msg[0], tag, t);
        }).then(() => {
            // cleanup spies right here
            nodeTypes.forEach((nt) => {
                nodes[nt].startIO.restore();
                nodes[nt].send.restore();
            });
            t.pass('done with IO test teardown');
        }).catch(fixture.failAndEnd(t));
    }

    let platform = nodes[CONFIG_NODE].platform;
    t.ok(platform, 'config node has platform object');
    if (platform.connecting) {
        platform.on('connect', onConnect);
    } else {
        platform.isConnected().then((connected) => {
            if (connected) return onConnect(platform);
            t.fail('is not connected nor connecting');
        }).catch(fixture.failAndEnd(t));
    }
});

test('is resilient to platform disconnect when not closing', function(t) {
    if (! process.env.TEST_ALL) {
        t.skip('set TEST_ALL environment to true to enable resilience test');
        return t.end();
    }
    t.plan(10);

    const RECOVERY_TIMEOUT = 60 * 6 * 1000; // 6 minutes
    let confNodeDesc = fixture.createNodeDescriptor(RED, CONFIG_NODE);
    let allNodeDesc = fixture.createNodeDescriptor(RED, ALL_NODE, confNodeDesc.id);
    let nflow = {
        label: "Test2 Flow",
        nodes: [allNodeDesc],
        configs: [confNodeDesc]
    };
    let sendSpy;

    function testResilience(platform) {
        RED.nodes.addFlow(nflow).then((flowid) => {
            t.ok(flowid, 'successfully created test flow with our nodes');
            t.notEqual(flowid, testFlow, 'created flow has its own ID');
            return new Promise((resolve) => {
                setTimeout(() => resolve(RED.nodes.removeFlow(flowid)), 1500);
            });
        }).then(() => {
            t.pass('successfully removed (stopped) new flow again');
            return new Promise((resolve) => {
                setTimeout(() => resolve(platform.isSignedIn()), 500);
            });
        }).then((signedIn) => {
            t.equal(signedIn, false, 'platform is now signed out');
            let nodeObj = RED.nodes.getNode(nodes[ALL_NODE].id);
            t.ok(nodeObj, `retrieved instance of node ${nodeObj.id} for testing recovery`);
            let confNode = RED.nodes.getNode(nodeObj.config.cloud);
            if (! confNode) {
                t.fail(`failed to retrieve config node for ${nodeObj.id}`);
            } else if (confNode.platform === undefined) {
                t.fail(`config node for ${nodeObj.id} does not have platform instance`);
            } else {
                confNode.platform.once('connect', () => {
                    t.pass(`platform instance of ${confNode.id} signed in again`);
                });
            }
            sendSpy = sinon.spy(nodeObj, "send");
            return new Promise((resolve, reject) => {
                let timer = setTimeout(reject.bind(null, nodeObj), RECOVERY_TIMEOUT);
                nodeObj.send = function(msg) {
                    nodeObj.send = sendSpy;
                    nodeObj.send(msg);
                    clearTimeout(timer);
                    t.ok(msg, 'remaining flow recovered to continue sending data');
                    resolve(nodeObj);
                };
            });
        }).then((nodeObj) => {
            setTimeout(() => {
                nodeObj.send.restore();
                let topics = new Set();
                sendSpy.args.map((args) => topics.add(args[0].topic));
                t.equal(topics.size, sendSpy.callCount, 'sent each topic (= sensor) only once');
            }, 100);
            return nodeObj;
        }).catch((nodeObj) => {
            if (sendSpy) {
                nodeObj.send = sendSpy;
                nodeObj.send.restore();
            }
            t.fail('remaining flow failed to continue receiving data');
            t.end();
        });
    }

    let platform = nodes[CONFIG_NODE].platform;
    t.ok(platform, 'config node has platform object');
    platform.isSignedIn().then((signedIn) => {
        t.equal(signedIn, true, "platform is connected");
        return testResilience(platform);
    }).catch(fixture.failAndEnd(t));
});
