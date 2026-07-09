const axios = require('axios');

async function testUrl(url) {
  const host = '91.124.50.84';
  const port = 49176;
  const username = 'dd9wBT4aXL84tl9';
  const password = 'C3ZiiaYAsRVUq0O';

  const config = {
    timeout: 5000,
    proxy: {
      host: host,
      port: port,
      protocol: 'http'
    }
  };

  if (username && password) {
    config.proxy.auth = { username, password };
  }

  console.log(`Testing connection through proxy to ${url}...`);
  try {
    const res = await axios.get(url, config);
    console.log(`✅ Success! Status code: ${res.status}`);
  } catch (err) {
    console.error(`❌ Failed: ${err.message}`);
    if (err.response) {
      console.error(`Response status: ${err.response.status}`);
    }
  }
}

async function run() {
  console.log('--- HTTP Test ---');
  await testUrl('http://www.google.com');

  console.log('\n--- HTTPS Test ---');
  await testUrl('https://www.google.com');
}

run();
