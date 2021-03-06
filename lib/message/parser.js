"use strict";
const zlib = require("zlib");
const querystring = require("querystring");
const {downloadMultiMsg, getGroupFileUrl} = require("./storage");
const pb = require("../pb");

function escapeCQInside(s) {
    if (s === "&") return "&amp;";
    if (s === ",") return "&#44;";
    if (s === "[") return "&#91;";
    if (s === "]") return "&#93;";
}
function escapeCQ(s) {
    if (s === "&") return "&amp;";
    if (s === "[") return "&#91;";
    if (s === "]") return "&#93;";
}

async function parseMessage(rich, from = 0) {
    const elems = Array.isArray(rich[2]) ? rich[2] : [rich[2]];
    if (rich[4])
        elems.unshift(Object.setPrototypeOf({}, {9999: rich[4]}));
    let extra = {}, anon = {};
    const chain = [];
    let raw_message = "";
    let bface_tmp = null, ignore_text = false;
    for (let v of elems) {
        const type = parseInt(Object.keys(Reflect.getPrototypeOf(v))[0]);
        const msg = {type:"",data:{}};
        const o = v[type];
        switch (type) {
            case 21: //anonGroupMsg
                anon = o;
                break;
            case 16: //extraInfo
                extra = o;
                break;
            case 37: //generalFlags
                if (o[7])
                    return await parseMultiMsg.call(this, o[7].raw, from);
                break;
            case 12: //xml
                break;
            case 51:
                try {
                    [msg.type, msg.data] = await parseJsonElem.call(this, o);
                    ignore_text = true;
                } catch (e) {}
                break;
            case 5:
                [msg.type, msg.data] = await parseTransElem.call(this, o, from);
                ignore_text = true;
                break;
            case 1:
                if (ignore_text) break;
                if (bface_tmp && o[1]) {
                    msg.data.file = bface_tmp, msg.type = "bface";
                    msg.data.text = String(o[1].raw).replace("[","").replace("]","").trim();
                    bface_tmp = null;
                    break;
                }
                if (o[3] && o[3].raw[1] === 1) {
                    msg.type = "at";
                    if (o[3].raw[6] === 1)
                        msg.data.qq = "all"
                    else
                        msg.data.qq = o[3].raw.readUInt32BE(7);
                } else {
                    msg.type = "text";
                }
                msg.data.text = String(o[1].raw);
                break;
            case 2:
                msg.type = "face", msg.data.id = o[1];
                break;
            case 6:
                bface_tmp = o[4].raw.toString("hex") + o[7].raw.toString("hex") + o[5];
                break;
            case 4: //notOnlineImage
                msg.type = "image";
                msg.data.file = o[7].raw.toString("hex") + (o[2]?o[2]:"");
                if (o[15])
                    msg.data.url = "http://c2cpicdw.qpic.cn" + o[15].raw;
                break;
            case 8: //customFace
                msg.type = "image";
                msg.data.file = o[13].raw.toString("hex") + (o[25]?o[25]:"");
                if (o[16])
                    msg.data.url = "http://gchat.qpic.cn" + o[16].raw;
                break;
            case 53:
                if (o[1] === 3) {
                    msg.type = "flash";
                    if (o[2][1]) //notOnlineImage
                        msg.data.file = o[2][1][13].raw.toString("hex") + (o[2][1][25]?o[2][1][25]:"");
                    else if (o[2][2]) //customFace
                        msg.data.file = o[2][1][7].raw.toString("hex") + (o[2][1][2]?o[2][1][2]:"");
                    ignore_text = true;
                } else if (o[1] === 33) {
                    msg.type = "sface";
                    msg.data.id = o[2][1];
                    msg.data.text = String(o[2][2].raw);
                }
                break;
            case 9999:
                [msg.type, msg.data] = await parsePttElem.call(this, o, from);
                ignore_text = true;
                break;
        }
        if (msg.type) {
            if (msg.type === "text" && chain[chain.length-1] && chain[chain.length-1].type === "text")
                chain[chain.length-1].data.text += msg.data.text;
            else
                chain.push(msg);
            if (msg.type === "text")
                raw_message += msg.data.text.replace(/[&\[\]]/g, escapeCQ);
            else
                raw_message += genCQMsg(msg);
        }
    }
    return {chain, raw_message, extra, anon};
}

function genCQMsg(msg) {
    return `[CQ:${msg.type},${querystring.stringify(msg.data, ",", "=", {encodeURIComponent: (s)=>s.replace(/&|,|\[|\]/g, escapeCQInside)})}]`;
}

async function parseMultiMsg(resid, from) {
    const buf = await downloadMultiMsg.call(this, resid, 1);
    let msg = pb.decode(buf)[1];
    // if (Array.isArray(msg)) msg = msg[0];
    return await parseMessage.call(this, msg[3][1], from);
}

async function parsePttElem(o) {
    const data = {md5: o[4].raw.toString("hex")};
    if (o[20]) {
        const url =  String(o[20].raw);
        data.file = url.startsWith("http") ? url : "https://grouptalk.c2c.qq.com" + url;
    } else if (o[3]) {
        data.file = o[3].raw.toString("hex");
    }
    return ["record", data];
}

async function parseTransElem(o, from) {
    let v = pb.decode(o[2].raw.slice(3))[7];
    v = v[2];
    let rsp = await getGroupFileUrl.call(this, from, v[1], v[2].raw);
    const data = {
        name:     String(v[4].raw),
        url:      `http://${rsp[4].raw}/ftn_handler/${rsp[6].raw.toString("hex")}/?fname=${v[4].raw}`,
        size:     v[3],
        md5:      rsp[9].raw.toString("hex"),
        duration: v[5],
    };
    return ["file", data];
}

async function parseXmlElem() {
    // xml消息 35合并转发 1415群好友推荐
    // var a = o.template1.slice(1);
    // a = zlib.unzipSync(a);
    // console.log(a.toString());
    throw new Error("not support yet");
}

async function parseJsonElem(o) {
    o = JSON.parse(zlib.unzipSync(o[1].raw.slice(1)));
    let type, data = {};
    if (o.app === "com.tencent.map") {
        type = "location";
        data = o.meta["Location.Search"];
        if (!data.id)
            delete data.id;
        delete data.from;
    } else if (o.app === "com.tencent.mannounce") {
        type = "notice";
        data.title = Buffer.from(o.meta.mannounce.title, "base64").toString();
        data.content = Buffer.from(o.meta.mannounce.text, "base64").toString();
    } else {
        throw new Error("unknown json msg");
    }
    return [type, data];
}

module.exports = parseMessage;
