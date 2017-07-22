"use strict";
const dgram = require('dgram');
const crc = require('crc');
const EventEmitter = require('events');

class HDLDriver extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.echo = true;
    this.server = dgram.createSocket('udp4');

    var that = this;

    this.server.on('listening', function () {
      var address = that.server.address();
      console.log('UDP Server listening on ' + address.address + ":" + address.port);
      that.connected = true;
    });

    this.server.on('message', (msg) => this.decodeHeader(msg));

    this.server.on('error', (err) => console.log('UDP connection error :' + err));
  }

  connect(host, port, gateway) {
    if (this.connected) {
      console.log("WARNING: already connected, ignoring command");
      return;
    }
    this.host = host;
    this.port = port;
    this.gateway = gateway;
    this.server.bind(this.port, this.host);
  }

  disconnect() {
    this.server.close();
    this.connected = false;
    this.host = "";
    this.port = "";
  }

  decodeHeader(message) {
    var hdl = new Object();
    hdl.header = {};
    hdl.body = {};
    var source_ip = "" + message[0] + '.' + message[1] + '.' + message[2] + '.' + message[3];
    var magic = message.toString('ascii', 4, 14);
    var start_valid = message[14] == 0xAA && message[15] == 0xAA;
    var valid = magic == "HDLMIRACLE" && start_valid;
    var data_len = message.readUInt8(16); //minimal len - 11
    hdl.header.source_subnet = message.readUInt8(17);
    hdl.header.source_ip = message.readUInt8(18);
    hdl.header.source_type = message.readUInt16BE(19);
    hdl.header.operation = message.readUInt16BE(21);
    hdl.header.target_subnet = message.readUInt8(23);
    hdl.header.target_ip = message.readUInt8(24);
    var arg_len = data_len - 11;
    hdl.body.raw = message.slice(25, 25 + arg_len);
    this.emit("parsedMessage", hdl);
  }

  sendCommand(command, args) {
    if (!this.connected) {
      console.log("ERROR: trying to send command while disconnected");
      return;
    }
    var prefix = new Buffer("c0a8010448444c4d495241434c45aaaa", "hex");
    var commandLine = "0cfefffe" + command + args.join("");
    commandLine = (commandLine.length/2+3).toString(16) + commandLine;
    if (commandLine.length%2) commandLine = "0" + commandLine;
    var commandBuffer = new Buffer(commandLine, "hex");
    
    var crcStr = "0000" + crc.crc16xmodem(commandBuffer).toString(16);
    crcStr = crcStr.substr(crcStr.length - 4, 4);
    var postfix = new Buffer(crcStr, "hex");

    var fullCommand = Buffer.concat([prefix, commandBuffer, postfix]);
    if (this.echo) {
      this.decodeHeader(fullCommand);
    }
    this.server.send(fullCommand, 0, fullCommand.length, 6000, this.gateway);
  }
}

module.exports = new HDLDriver();