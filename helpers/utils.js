const Client = require('lightrpc');
const bluebird = require('bluebird');
const client = Client.createClient('https://api.steemit.com');
bluebird.promisifyAll(client);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const getBlock = (blockNum) => client.sendAsync('get_block', [blockNum]);

const getOpsInBlock = (blockNum, onlyVirtual = false) => client.sendAsync('get_ops_in_block', [blockNum, onlyVirtual]);

const getGlobalProps = () => client.sendAsync('get_dynamic_global_properties', []);

const mutliOpsInBlock = (start, limit, onlyVirtual = false) => {
  const request = [];
  for (let i = start; i < start + limit; i++) {
    request.push('get_ops_in_block', [i, onlyVirtual]);
  }
  return client.sendBatchAsync(request, { timeout: 20000 });
};

const getBlockOps = (block) => {
  const operations = [];
  block.transactions.forEach(transaction => {
    operations.push(...transaction.operations);
  });
  return operations;
};

module.exports = {
  sleep,
  getBlock,
  getOpsInBlock,
  getGlobalProps,
  mutliOpsInBlock,
  getBlockOps,
};
