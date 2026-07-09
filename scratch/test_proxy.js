const axios = require('axios');
require('dotenv').config({ path: '../.env' });

async function test(host, port, username, password) {
  const url = 'http://google.com';
  const config = {
    timeout: 5000,
    proxy: {
      host: host,
      port: parseInt(port),
      protocol: 'http'
    }
  };
  if (username && password) {
    config.proxy.auth = { username, password };
  }

  console.log(`Testing ${host}:${port} with auth: ${!!username}...`);
  try {
    const start = Date.now();
    const res = await axios.get(url, config);
    console.log(`✅ Success! Status: ${res.status} in ${Date.now() - start}ms`);
    return true;
  } catch (err) {
    console.log(`❌ Failed: ${err.message}`);
    return false;
  }
}

async function run() {
  const host = '91.124.50.84';
  const port = 12323;
  const user = '14a3275f0452d';
  const pass = '5d08ec598d';
  
  console.log('--- Test with credentials ---');
  await test(host, port, user, pass);

  console.log('\n--- Test without credentials ---');
  await test(host, port);
}

run();
