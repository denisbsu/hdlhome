"use strict";
const EventEmitter = require('events');
var util = require('util');
var iconv = require('iconv');
var converter = new iconv.Iconv('windows-1251', 'utf8');



var padHexStr = function(hexString) {
  if (hexString.length%2) hexString = "0" + hexString;
  return hexString;
}

var uintStr2hexStr = function(intStr) {
  return padHexStr(parseInt(intStr).toString(16));
}

/*
65534 - PC
3501 - HDL-MHRCU.433 - 22ch MIX Module
322  - SB-CMS-8in1 - 8in1 Sensor Module
615  - HDL-MD0403.432 - 4ch Dimmer Module
134  - SB-MTS04.2 - 4ch Temp Module
2003 - HDL-MP6B.48 - 6ch Buttons Module
2004 - HDL-MP8B.48 - 8ch Buttons Module
1109 - SB-DN-Logic960 - Logic Timer Module
446  - HDL-MR1216.433 - 12ch Relay Module
447  - HDL-MR0410.431 - 4ch Relay Module
162  - HDL-MPL8.48-FH - DLP Panel Module
324  - HDL-MSPU03.4C - Ultrasonic Sensor Module
323  - HDL-MSP02.4C - PIR Sensor Module
*/

var getDevTypeName = function(type) {
  switch (type) {
    case 65534: return "PCM";
    case 3501: return "MIX";
    case 322:  return "8i1";
    case 615:  return "4DM";
    case 134:  return "TEM";
    case 2003: return "6BM";
    case 2004: return "8BM";
    case 1109: return "LTM";
    case 446:  return "12R";
    case 447:  return "04R";
    case 162:  return "DLP";
    case 324:  return "USO";
    case 323:  return "PIR";
  }
  return type;
}


var parseBuffer = function(template, buffer) {
  var result = "";
  var escape = false;
  for (var i = 0; i < template.length; i++) {
    if (!escape) {
      if (template[i] == '%') {
        escape = true;
      } else {
        result = result + template[i];
      }
    } else {
      if (template[i] == '%') {
        result = result + '%';
      } else {
        if (buffer.length == 0) {
          result = result + "NOT ENOUGH ARGS";
          break;
        }
        var subst = template[i];
        if (subst == 'v') {
          if (buffer.length == 1) subst = 'u';
          if (buffer.length == 2) subst = 'U';
          if (buffer.length == 4) subst = 'f';
        }
        switch (subst) {
          case 'r':
            result = result + (buffer.readUInt8(0) == 0xf8 ? "OK" : "FAIL");
            buffer = buffer.slice(1);
            break;          
          case 'u':
            result = result + buffer.readUInt8(0);
            buffer = buffer.slice(1);
            break;          
          case 'U':
            result = result + buffer.readUInt16BE(0);
            buffer = buffer.slice(2);
            break;          
          case 'i':
            result = result + buffer.readInt8(0);
            buffer = buffer.slice(1);
            break;          
          case 'I':
            result = result + buffer.readInt16BE(0);
            buffer = buffer.slice(2);
            break;          
          case 'f':
            try {
              result = result + buffer.readFloatLE(0);
              buffer = buffer.slice(4);
            } catch (e){
              result = result + "Can't parse (" + buffer.toString('hex') + ")";
              buffer = new Buffer(0);
            }
            break;          
          case 's':
            var temp = converter.convert(buffer).toString();
            buffer = buffer.slice(temp.length);
            result = result + temp;
            break;
          case 'l':
            result = result + (buffer.readUInt8(0) == 0 ? "OR " : "AND ");
            buffer = buffer.slice(1);
            break;            
          case 'b':
            result = result + (buffer.readUInt8(0) ? "true" : "false");
            buffer = buffer.slice(1);
            break;            
          case 't':
            result = result + (["Lux", "Temp", "Power", "Current", "Pressure"][buffer.readUInt8(0)]);
            buffer = buffer.slice(1);
            break;            
          case 'h':
            var len = parseInt(template.substr(i+1));
            if (len) {
              result = result + buffer.toString('hex', 0, len);
              buffer = buffer.slice(len);
              i = i + len.toString().length;
            }
            break;          
        }
      }
      escape = false;
    }
  }
  if (buffer.length > 0) {
    result = result + " Unused: " + buffer.toString('hex');
  }
  return result;
}
var commands_text = require("./commands_text.js");  //eval(fs.readFileSync("commands_text.json"));
var commands_args = require("./commands_args.js");

var adjust_code = {
  0x1c01: function(a) {a[4] = (-a[4] + 8)},
  0x1c02: function(a) {a[4] = (-a[4] + 8)},
  0x1619: function(a) {Buffer(a.slice(1).reduce(function(acc, v, i){ return (v == 1) ? (acc + ", " + (i+1)) : acc }, "").substr(2)).copy(a,1)},
  0x1632: function(a) {Buffer(a.slice(1).reduce(function(acc, v, i){ return (v != 0) ? (acc + ", " + (i+1) + " - " + v) : acc }, "").substr(2)).copy(a,1)},
  0x1647: function(a) {a[0] = (a[0] - 20)},
}


var getCallDescription = function(operation, args, type) {
  var op_string = operation.toString(16);
  var arg_string = args.toString('hex');

  if (commands_text[operation] !== undefined) {
    op_string = commands_text[operation];
  }

  if (adjust_code[operation] !== undefined) {
    adjust_code[operation](args);
  }

  if (commands_args[operation] !== undefined) {
    arg_string = parseBuffer(commands_args[operation], args);
  }
  return util.format("%s(%s)", op_string, arg_string);
}




class HDLWrapper extends EventEmitter {
  constructor() {
    super();
    this.driver = require('./HDLDriver');
    this.commandDictionary = require("./commands_text.js");
    //this.driver.addListener("parsedMessage", this.decodeMessage);
    this.driver.addListener("parsedMessage", (msg) => this.decodeMessage(msg));
  }

  connect(host, port, gateway) {
    this.driver.connect(host, port, gateway);
  }

  disconnect() {
    this.driver.disconnect();
  }

  sendCommand(command, args) {
    var localDictionary = this.commandDictionary;
    var hexCommand = Object.keys(localDictionary).filter(function(key) {return localDictionary[key] === command})[0];
    hexCommand = "0000" + uintStr2hexStr(hexCommand);
    hexCommand = hexCommand.substr(hexCommand.length - 4, 4);
    var transformedArgs = args.map(uintStr2hexStr);
    this.driver.sendCommand(hexCommand, transformedArgs);
  }

  decodeMessage(message) {

    var rawBody = message.body.raw;
    var header = message.header;

    var hdl_source = ("   " + header.source_ip).slice(-3) + "(" + getDevTypeName(header.source_type) +")";
    var hdl_target = ("   " + header.target_ip).slice(-3)
    var callString = getCallDescription(header.operation, rawBody, header.source_type);
    message.body.callString = callString;
    message.body.deviceName = getDevTypeName(header.source_type);
    console.log(util.format("%s -> %s %s", hdl_source, hdl_target, callString));
    //mongoWrite(hdl, getDevTypeName(hdl.source_type), callString, hdl.args.toString('hex'));
    //var callback = callbacks[header.operation];
    //if (callback) callback(hdl, getDevTypeName(hdl.source_type), callString, hdl.args.toString('hex'));
    //else io.emit('network activity', util.format("%s -> %s %s", hdl_source, hdl_target, callString));


    this.emit("message", message);
  }

}

module.exports = new HDLWrapper();