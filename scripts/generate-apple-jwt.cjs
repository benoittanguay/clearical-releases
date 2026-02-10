// Generate Apple Sign In JWT for Supabase
// Run with: node scripts/generate-apple-jwt.js

const fs = require('fs');
const crypto = require('crypto');

// Configuration
const TEAM_ID = '98UY743MSB';
const KEY_ID = '28MNZYSS2D';
const CLIENT_ID = 'io.clearical.auth'; // Your Service ID
const KEY_FILE = '/Users/benoittanguay/Documents/Clearical/Keys/AuthKey_28MNZYSS2D.p8';

// Read the private key
const privateKey = fs.readFileSync(KEY_FILE, 'utf8');

// Create JWT header (Apple doesn't require 'typ' field)
const header = {
  alg: 'ES256',
  kid: KEY_ID
};

// Create JWT payload
const now = Math.floor(Date.now() / 1000);
const sixMonthsFromNow = now + (6 * 30 * 24 * 60 * 60); // 6 months in seconds

const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: sixMonthsFromNow,
  aud: 'https://appleid.apple.com',
  sub: CLIENT_ID
};

// Base64URL encode
function base64url(data) {
  return Buffer.from(JSON.stringify(data))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Create the JWT
const encodedHeader = base64url(header);
const encodedPayload = base64url(payload);
const signatureInput = `${encodedHeader}.${encodedPayload}`;

// Sign with ES256
const sign = crypto.createSign('SHA256');
sign.update(signatureInput);
sign.end();

const signature = sign.sign(privateKey, 'base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=/g, '');

const jwt = `${signatureInput}.${signature}`;

console.log('\n=== Apple Sign In JWT for Supabase ===\n');
console.log('Copy this JWT into the "Secret Key (for OAuth)" field:\n');
console.log(jwt);
console.log('\n');
console.log('⚠️  This JWT expires in 6 months. You will need to regenerate it.');
console.log(`Expiration date: ${new Date(sixMonthsFromNow * 1000).toLocaleDateString()}\n`);
