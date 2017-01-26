# node-red-contrib-wirelesstag

A node for [Node-RED] that represents the sensor(s) of a
[Wireless Tag]. Nodes communicate with the
[Wirelesstag JSON Web Service API] using the [wirelesstags] NodeJS
package.

## Prerequisites

To run these nodes, you must have an account with a Wirelesstag
server. The server can be the one hosted by the vendor, or a
self-hosted one; the base URI for the API endpoint can be configured
if different from the default.

Instead of using the credentials of your "main" account, it is highly
recommended to create a separate service account as a "limited user"
for authenticating through this package.
([Reasons](https://github.com/hlapp/wirelesstags-js#installation-and-setup).)

## Installation

Run the follwing command in the root directory of your Node-RED installation.
Usually this is `~/.node-red` .

```
$ npm install node-red-contrib-wirelesstag
```

This should also install the dependencies.

## Usage

For each node, the following parameters are configurable:

* The API connection (email, password, and base URI for the JSON
  Web API server).
* The tag manager, tag, and sensor for which to report data. The lists
  of available choices are auto-populated.
* Optionally, the message topic. If left empty, the topic is
  auto-generated.
* Optionally, a name for the node. If left empty, the name is
  auto-generated from the tag and sensor names.

### Output

The message sent by the node will have the following properties aside
from `topic`:

* `msg.payload` with properties `reading` (the sensor's current
  reading), `eventState` (the current state, such as _Normal_, _Too
  High_, etc), and `armed` (true if the sensor is armed and false
  otherwise).
* `msg.sensorConfig`: the properties of the monitoring configuration
  for the sensor, will depend on the sensor.
* `msg.tag`: additional properties of the tag (`name`, `uuid`,
  `slaveId`, `alive`, and `updateInterval`).
* `msg.tagManager`: additional properties of the tag manager with
  which the tag is associated (`name`, `mac`, and `online`).

The node uses a polling API endpoint to continuously poll for updates.
(This is the same mechanism as the [Wirelesstag web-application]
uses.) How frequently new data becomes available for which tag is
determined by the update interval configured for each tag (and can
thus be changed using the Wirelesstag native web or mobile apps).

### Input

When connected on input, the node inspect `msg.payload` properties to
set matching tag and sensor configuration properties. To match,
properties must be in the same structure and of the same type as they
are output by the node. The following properties are recognized:

* `armed`: arm the sensor if true, and disarm otherwise.
* `tag.updateInterval`: set the update interval for the tag.
* `sensorConfig.*`: set the corresponding sensor configuration
  properties.

Desired payloads can, for example, be injected with the "inject" node,
or created and set with the "change" node. For example, the following
as JSON-format payload for the "inject" will change the notification
sound for the sensor:

```js
{ "sensorConfig": { "notifySettings": { "sound": "moo" } } }
```

In the change node, choose "msg." from the selector and the following
expression for specifying the property:

```js
sensorConfig.notifySettings.sound
```

If no matching `msg.payload` property is detected upon receiving
input, this will instead trigger updating the sensor's data from the
cloud. If this results in new data, it will generate a message on
output.

### Caveats and limitations

* Auto-populating the dropdowns for the tag manager, tag, and sensor
  selection requires a live connection made through the [wirelesstags]
  API. Due to the way the Node-RED editor works, this isn't available
  until the respective cloud API configuration node is _deployed_.
  Hence, when setting up a node with a new cloud API configuration,
  the node _must_ first be deployed (with necessarily incomplete
  configuration). Then configuration can be resumed.
* In principle each event (such as motion detected, temperature too
  high, etc) for armed sensors should result in data becoming
  available for the corresponding tag shortly thereafter. In practice,
  this does not always seem to be the case, in particular for the
  event of returning to "normal".
* The [wirelesstags] library currently only supports username/password
  authentication, and hence so does this node.
* Even though the configuration interface allows multiple API
  connections to be configured, all tags will at present use the same
  API connection (normally the first one), because the [wirelesstags]
  library cannot currently switch between sessions using different
  sets of credentials.

## How to support

Aside from reporting issues and contributing pull requests, if you
plan to buy from Wireless Sensor Tag, you might consider using
[this link](https://goo.gl/GxwQbZ) to their website. If more than 10
people do so, and some end up buying, I stand to receive a discount on
a past purchase of mine, which will allow me to buy other types of
tags in the future and support those too.

## Credits

The icon is derived from the ["Wifi" icon by Peter Borges] of The Noun
Project.

## License

Available under the [MIT License](LICENSE).

[Node-RED]: https://nodered.org
[Wireless Tag]: http://wirelesstag.net
[Wirelesstag web-application]: https://wirelesstag.net/eth/
[Wirelesstag JSON Web Service API]: http://mytaglist.com/media/mytaglist.com/apidoc.html
[wirelesstags]: https://github.com/hlapp/wirelesstags-js
["Wifi" icon by Peter Borges]: https://thenounproject.com/term/iot/362213/
