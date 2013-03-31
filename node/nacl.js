var nacl_raw = require("./nacl_raw.js").Module;
nacl_raw.RandomBytes.crypto = require('crypto');

this.random_bytes = function (count) {
    return nacl_raw.RandomBytes.crypto.randomBytes(count);
};
var nacl = (function () {
    var exports = {};

    //---------------------------------------------------------------------------
    // Horrifying UTF-8 and hex codecs

    function encode_utf8(s) {
	var encoded = unescape(encodeURIComponent(s));
	var result = new Uint8Array(encoded.length);
	for (var i = 0; i < encoded.length; i++) {
	    result[i] = encoded.charCodeAt(i);
	}
	return result;
    }

    function decode_utf8(bs) {
	var encoded = [];
	for (var i = 0; i < bs.length; i++) {
	    encoded.push(String.fromCharCode(bs[i]));
	}
	return decodeURIComponent(escape(encoded.join('')));
    }

    function to_hex(bs) {
	var encoded = [];
	for (var i = 0; i < bs.length; i++) {
	    encoded.push("0123456789abcdef"[(bs[i] >> 4) & 15]);
	    encoded.push("0123456789abcdef"[bs[i] & 15]);
	}
	return encoded.join('');
    }

    //---------------------------------------------------------------------------

    function injectBytes(bs, leftPadding) {
	var p = leftPadding || 0;
	var address = nacl_raw._malloc(bs.length + p);
	nacl_raw.HEAPU8.set(bs, address + p);
	for (var i = address; i < address + p; i++) {
	    nacl_raw.HEAPU8[i] = 0;
	}
	return address;
    }

    function check_injectBytes(function_name, what, thing, expected_length, leftPadding) {
	check_length(function_name, what, thing, expected_length);
	return injectBytes(thing, leftPadding);
    }

    function extractBytes(address, length) {
	var result = new Uint8Array(length);
	result.set(nacl_raw.HEAPU8.subarray(address, address + length));
	return result;
    }

    //---------------------------------------------------------------------------

    function check(function_name, result) {
	if (result !== 0) {
	    throw {message: "nacl_raw." + function_name + " signalled an error"};
	}
    }

    function check_length(function_name, what, thing, expected_length) {
	if (thing.length !== expected_length) {
	    throw {message: "nacl." + function_name + " expected " +
	           expected_length + "-byte " + what + " but got length " + thing.length};
	}
    }

    function Target(length) {
	this.length = length;
	this.address = nacl_raw._malloc(length);
    }

    Target.prototype.extractBytes = function (offset) {
	var result = extractBytes(this.address + (offset || 0), this.length - (offset || 0));
	nacl_raw._free(this.address);
	this.address = null;
	return result;
    };

    function free_all(addresses) {
	for (var i = 0; i < addresses.length; i++) {
	    nacl_raw._free(addresses[i]);
	}
    }

    //---------------------------------------------------------------------------
    // Boxing

    function crypto_box_keypair() {
	var pk = new Target(nacl_raw._crypto_box_PUBLICKEYBYTES);
	var sk = new Target(nacl_raw._crypto_box_SECRETKEYBYTES);
	check("_crypto_box_keypair", nacl_raw._crypto_box_keypair(pk.address, sk.address));
	return {boxPk: pk.extractBytes(), boxSk: sk.extractBytes()};
    }

    function crypto_box_random_nonce() {
	return nacl_raw.RandomBytes.crypto.randomBytes(nacl_raw._crypto_box_NONCEBYTES);
    }

    function crypto_box(msg, nonce, pk, sk) {
	var m = injectBytes(msg, nacl_raw._crypto_box_ZEROBYTES);
	var na = check_injectBytes("crypto_box", "nonce", nonce, nacl_raw._crypto_box_NONCEBYTES);
	var pka = check_injectBytes("crypto_box", "pk", pk, nacl_raw._crypto_box_PUBLICKEYBYTES);
	var ska = check_injectBytes("crypto_box", "sk", sk, nacl_raw._crypto_box_SECRETKEYBYTES);
	var c = new Target(msg.length + nacl_raw._crypto_box_ZEROBYTES);
	check("_crypto_box", nacl_raw._crypto_box(c.address, m, c.length, 0, na, pka, ska));
	free_all([na, pka, ska]);
	return c.extractBytes(nacl_raw._crypto_box_BOXZEROBYTES);
    }

    function crypto_box_open(ciphertext, nonce, pk, sk) {
	var c = injectBytes(ciphertext, nacl_raw._crypto_box_BOXZEROBYTES);
	var na = check_injectBytes("crypto_box", "nonce", nonce, nacl_raw._crypto_box_NONCEBYTES);
	var pka = check_injectBytes("crypto_box", "pk", pk, nacl_raw._crypto_box_PUBLICKEYBYTES);
	var ska = check_injectBytes("crypto_box", "sk", sk, nacl_raw._crypto_box_SECRETKEYBYTES);
	var m = new Target(ciphertext.length + nacl_raw._crypto_box_BOXZEROBYTES);
	check("_crypto_box_open", nacl_raw._crypto_box_open(m.address, c, m.length, 0, na, pka, ska));
	free_all([na, pka, ska]);
	return m.extractBytes(nacl_raw._crypto_box_ZEROBYTES);
    }

    function crypto_box_precompute(pk, sk) {
	var pka = check_injectBytes("crypto_box", "pk", pk, nacl_raw._crypto_box_PUBLICKEYBYTES);
	var ska = check_injectBytes("crypto_box", "sk", sk, nacl_raw._crypto_box_SECRETKEYBYTES);
	var k = new Target(nacl_raw._crypto_box_BEFORENMBYTES);
	check("_crypto_box_beforenm",
	      nacl_raw._crypto_box_beforenm(k.address, pka, ska));
	free_all([pka, ska]);
	return {boxK: k.extractBytes()};
    }

    function crypto_box_precomputed(msg, nonce, state) {
	var m = injectBytes(msg, nacl_raw._crypto_box_ZEROBYTES);
	var na = check_injectBytes("crypto_box_precomputed",
				   "nonce", nonce, nacl_raw._crypto_box_NONCEBYTES);
	var ka = check_injectBytes("crypto_box_precomputed",
				   "boxK", state.boxK, nacl_raw._crypto_box_BEFORENMBYTES);
	var c = new Target(msg.length + nacl_raw._crypto_box_ZEROBYTES);
	check("_crypto_box_afternm",
	      nacl_raw._crypto_box_afternm(c.address, m, c.length, 0, na, ka));
	free_all([na, ka]);
	return c.extractBytes(nacl_raw._crypto_box_BOXZEROBYTES);
    }

    function crypto_box_open_precomputed(ciphertext, nonce, state) {
	var c = injectBytes(ciphertext, nacl_raw._crypto_box_BOXZEROBYTES);
	var na = check_injectBytes("crypto_box_open_precomputed",
				   "nonce", nonce, nacl_raw._crypto_box_NONCEBYTES);
	var ka = check_injectBytes("crypto_box_open_precomputed",
				   "boxK", state.boxK, nacl_raw._crypto_box_BEFORENMBYTES);
	var m = new Target(ciphertext.length + nacl_raw._crypto_box_BOXZEROBYTES);
	check("_crypto_box_open_afternm",
	      nacl_raw._crypto_box_open_afternm(m.address, c, m.length, 0, na, ka));
	free_all([na, ka]);
	return m.extractBytes(nacl_raw._crypto_box_ZEROBYTES);
    }

    //---------------------------------------------------------------------------
    // Hashing

    function crypto_hash(bs) {
	var address = injectBytes(bs);
	var hash = new Target(nacl_raw._crypto_hash_BYTES);
	check("_crypto_hash", nacl_raw._crypto_hash(hash.address, address, bs.length, 0));
	nacl_raw._free(address);
	return hash.extractBytes();
    }

    function crypto_hash_string(s) {
	return crypto_hash(encode_utf8(s));
    }

    //---------------------------------------------------------------------------
    // Symmetric-key encryption

    function crypto_stream_random_nonce() {
	return nacl_raw.RandomBytes.crypto.randomBytes(nacl_raw._crypto_stream_NONCEBYTES);
    }

    function crypto_stream(len, nonce, key) {
	var na = check_injectBytes("crypto_stream",
				   "nonce", nonce, nacl_raw._crypto_stream_NONCEBYTES);
	var ka = check_injectBytes("crypto_stream",
				   "key", key, nacl_raw._crypto_stream_KEYBYTES);
	var out = new Target(len);
	check("_crypto_stream", nacl_raw._crypto_stream(out.address, len, 0, na, ka));
	free_all([na, ka]);
	return out.extractBytes();
    }

    function crypto_stream_xor(msg, nonce, key) {
	var na = check_injectBytes("crypto_stream_xor",
				   "nonce", nonce, nacl_raw._crypto_stream_NONCEBYTES);
	var ka = check_injectBytes("crypto_stream_xor",
				   "key", key, nacl_raw._crypto_stream_KEYBYTES);
	var ma = injectBytes(msg);
	var out = new Target(msg.length);
	check("_crypto_stream_xor",
	      nacl_raw._crypto_stream_xor(out.address, ma, msg.length, 0, na, ka));
	free_all([na, ka, ma]);
	return out.extractBytes();
    }

    //---------------------------------------------------------------------------
    // One-time authentication

    //---------------------------------------------------------------------------
    // Authentication

    //---------------------------------------------------------------------------
    // Authenticated symmetric-key encryption

    //---------------------------------------------------------------------------
    // Signing

    //---------------------------------------------------------------------------
    // Keys

    function crypto_sign_keypair_from_seed(bs) {
	// Hash the bytes to get a secret key. This will be MODIFIED IN
	// PLACE by the call to crypto_sign_keypair_from_raw_sk below.
	var hash = new Uint8Array(crypto_hash(bs));
	var ska = injectBytes(hash.subarray(0, nacl_raw._crypto_sign_SECRETKEYBYTES));
	var pk = new Target(nacl_raw._crypto_sign_PUBLICKEYBYTES);
	check("_crypto_sign_keypair_from_raw_sk",
	      nacl_raw._crypto_sign_keypair_from_raw_sk(pk.address, ska));
	var sk = extractBytes(ska, nacl_raw._crypto_sign_SECRETKEYBYTES);
	nacl_raw._free(ska);
	return {signPk: pk.extractBytes(), signSk: sk};
    }

    function crypto_box_keypair_from_seed(bs) {
	var hash = new Uint8Array(crypto_hash(bs));
	var ska = injectBytes(hash.subarray(0, nacl_raw._crypto_box_SECRETKEYBYTES));
	var pk = new Target(nacl_raw._crypto_box_PUBLICKEYBYTES);
	check("_crypto_scalarmult_curve25519_base",
	      nacl_raw._crypto_scalarmult_curve25519_base(pk.address, ska));
	var sk = extractBytes(ska, nacl_raw._crypto_box_SECRETKEYBYTES);
	nacl_raw._free(ska);
	return {boxPk: pk.extractBytes(), boxSk: sk};
    }

    //---------------------------------------------------------------------------

    exports.crypto_auth_BYTES = nacl_raw._crypto_auth_BYTES;
    exports.crypto_auth_KEYBYTES = nacl_raw._crypto_auth_KEYBYTES;
    exports.crypto_box_BEFORENMBYTES = nacl_raw._crypto_box_BEFORENMBYTES;
    exports.crypto_box_BOXZEROBYTES = nacl_raw._crypto_box_BOXZEROBYTES;
    exports.crypto_box_NONCEBYTES = nacl_raw._crypto_box_NONCEBYTES;
    exports.crypto_box_PUBLICKEYBYTES = nacl_raw._crypto_box_PUBLICKEYBYTES;
    exports.crypto_box_SECRETKEYBYTES = nacl_raw._crypto_box_SECRETKEYBYTES;
    exports.crypto_box_ZEROBYTES = nacl_raw._crypto_box_ZEROBYTES;
    exports.crypto_hash_BYTES = nacl_raw._crypto_hash_BYTES;
    exports.crypto_hashblocks_BLOCKBYTES = nacl_raw._crypto_hashblocks_BLOCKBYTES;
    exports.crypto_hashblocks_STATEBYTES = nacl_raw._crypto_hashblocks_STATEBYTES;
    exports.crypto_onetimeauth_BYTES = nacl_raw._crypto_onetimeauth_BYTES;
    exports.crypto_onetimeauth_KEYBYTES = nacl_raw._crypto_onetimeauth_KEYBYTES;
    exports.crypto_secretbox_BOXZEROBYTES = nacl_raw._crypto_secretbox_BOXZEROBYTES;
    exports.crypto_secretbox_KEYBYTES = nacl_raw._crypto_secretbox_KEYBYTES;
    exports.crypto_secretbox_NONCEBYTES = nacl_raw._crypto_secretbox_NONCEBYTES;
    exports.crypto_secretbox_ZEROBYTES = nacl_raw._crypto_secretbox_ZEROBYTES;
    exports.crypto_sign_BYTES = nacl_raw._crypto_sign_BYTES;
    exports.crypto_sign_PUBLICKEYBYTES = nacl_raw._crypto_sign_PUBLICKEYBYTES;
    exports.crypto_sign_SECRETKEYBYTES = nacl_raw._crypto_sign_SECRETKEYBYTES;
    exports.crypto_stream_BEFORENMBYTES = nacl_raw._crypto_stream_BEFORENMBYTES;
    exports.crypto_stream_KEYBYTES = nacl_raw._crypto_stream_KEYBYTES;
    exports.crypto_stream_NONCEBYTES = nacl_raw._crypto_stream_NONCEBYTES;

    exports.encode_utf8 = encode_utf8;
    exports.decode_utf8 = decode_utf8;
    exports.to_hex = to_hex;

    exports.crypto_box_keypair = crypto_box_keypair;
    exports.crypto_box_random_nonce = crypto_box_random_nonce;
    exports.crypto_box = crypto_box;
    exports.crypto_box_open = crypto_box_open;
    exports.crypto_box_precompute = crypto_box_precompute;
    exports.crypto_box_precomputed = crypto_box_precomputed;
    exports.crypto_box_open_precomputed = crypto_box_open_precomputed;

    exports.crypto_stream_random_nonce = crypto_stream_random_nonce;
    exports.crypto_stream = crypto_stream;
    exports.crypto_stream_xor = crypto_stream_xor;

    exports.crypto_hash = crypto_hash;
    exports.crypto_hash_string = crypto_hash_string;

    exports.crypto_sign_keypair_from_seed = crypto_sign_keypair_from_seed;
    exports.crypto_box_keypair_from_seed = crypto_box_keypair_from_seed;

    return exports;
})();
(function (exports) {
    for (var k in nacl) {
	exports[k] = nacl[k];
    }
})(this);