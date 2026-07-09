const axios = require('axios');

async function run() {
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

  console.log(`Testing connection through proxy ${host}:${port}...`);
  try {
    const res = await axios.get('http://www.google.com', config);
    console.log('✅ Connection successful!');
    console.log('Status code:', res.status);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
  }
}

run();
