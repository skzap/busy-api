let options = {
  saveElastic: true,
  saveRedis: process.argv[2],
}
if (!process.env.ELASTICHOST) options.saveElastic=false;

// redis = for notifications and head block number
// elastic search = for json_metadata and contents
// websocket = for serving notifications and ws steem node relay

const _ = require('lodash');
const WebSocket = require('ws');
const { Client } = require('busyjs');
const redis = require('./helpers/redis');
const elastic = require('./helpers/elasticsearch');
const utils = require('./helpers/utils');
const ipfs = require('./helpers/ipfs');

const port = process.env.PORT || 4000;
const wss = new WebSocket.Server({ port: port });

const steemdWsUrl = process.env.STEEMD_WS_URL || 'wss://rpc.buildteam.io';
const client = new Client(steemdWsUrl);

const cache = {};
const useCache =  false;

const limit = 100;

const clearGC = () => {
  try {
    global.gc();
  } catch (e) {
    console.log("You must run program with 'node --expose-gc index.js' or 'npm start'");
  }
};

setInterval(clearGC, 60 * 1000);

/** Init websocket server */

wss.on('connection', (ws) => {
  console.log('Got connection from new peer');
  ws.on('message', (message) => {
    console.log('Message', message);
    let call = {};
    try {
      call = JSON.parse(message);
    } catch (e) {
      console.error('Error WS parse JSON message', message, e);
    }

    if (call.method === 'get_notifications' && call.params && call.params[0]) {
      redis.lrangeAsync(`notifications:${call.params[0]}`, 0, -1).then((res) => {
        console.log('Send notifications', call.params[0], res.length);
        const notifications = res.map((notification) => JSON.parse(notification));
        ws.send(JSON.stringify({ id: call.id, result: notifications }));
      }).catch(err => {
        console.log('Redis get_notifications failed', err);
      });
    } else if (call.method && call.params) {
      client.call(call.method, call.params, (err, result) => {
        ws.send(JSON.stringify({ id: call.id, result }));
      });
    } else {
      ws.send(JSON.stringify({
        id: call.id,
        result: {},
        error: 'Something is wrong',
      }));
    }
  });
  ws.on('error', () => console.log('Error on connection with peer'));
  ws.on('close', () => console.log('Connection with peer closed'));
});

/** Stream the blockchain for notifications */

const isDtube = (params) => {
  let json = null;
  try {
    json = JSON.parse(params.json_metadata);
  } catch (err) {
    //console.log('Wrong json format on comment json_metadata', err);
  }

  if (json && json.video && json.video.info && json.video.content)
    return json.video;

  return false;
}

const getNotifications = (ops) => {
  const notifications = [];
  ops.forEach((op) => {
    const type = op.op[0];
    const params = op.op[1];
    switch (type) {
      case 'comment': {
        const isRootPost = !params.parent_author;
        const video = isDtube(params)
        delete video._id

        /** Find replies */
        if (!isRootPost) {
          const notification = {
            type: 'reply',
            parent_permlink: params.parent_permlink,
            author: params.author,
            permlink: params.permlink,
            timestamp: Date.parse(op.timestamp) / 1000,
            block: op.block,
          };
          notifications.push([params.parent_author, notification]);
        } else if (video) {
          ipfs.pin(video.content.video240hash)
          ipfs.pin(video.content.video480hash)
          ipfs.pin(video.content.video720hash)
          if (options.saveElastic) {
            elastic.index({
              index: 'dtube',
              type: 'video',
              id: video.info.author+'/'+video.info.permlink,
              body: video
            }).then((response) => {
              console.log(response.result+' '+response._id)
            }).catch(err => {
              console.error('Elastic index failed', err);
            });
          }
        }

        /** Find mentions */
        const pattern = /(@[a-z][-\.a-z\d]+[a-z\d])/gi;
        const content = `${params.title} ${params.body}`;
        const mentions = _.without(_.uniq(content.match(pattern))
          .join('@')
          .toLowerCase()
          .split('@')
          .filter(n => n), params.author)
          .slice(0, 9); // Handle maximum 10 mentions per post
        if (mentions.length) {
          mentions.forEach(mention => {
            const notification = {
              type: 'mention',
              is_root_post: isRootPost,
              author: params.author,
              permlink: params.permlink,
              timestamp: Date.parse(op.timestamp) / 1000,
              block: op.block,
            };
            notifications.push([mention, notification]);
          });
        }
        break;
      }
      case 'custom_json': {
        let json = {};
        try {
          json = JSON.parse(params.json);
        } catch (err) {
          console.log('Wrong json format on custom_json', err);
        }
        switch (params.id) {
          case 'follow': {
            /** Find follow */
            if (json[0] === 'follow' && json[1].follower && json[1].following && _.has(json, '[1].what[0]') && json[1].what[0] === 'blog') {
              const notification = {
                type: 'follow',
                follower: json[1].follower,
                timestamp: Date.parse(op.timestamp) / 1000,
                block: op.block,
              };
              notifications.push([json[1].following, notification]);
            }
            /** Find reblog */
            if (json[0] === 'reblog' && json[1].account && json[1].author && json[1].permlink) {
              const notification = {
                type: 'reblog',
                account: json[1].account,
                permlink: json[1].permlink,
                timestamp: Date.parse(op.timestamp) / 1000,
                block: op.block,
              };
              // console.log('Reblog', [json[1].author, JSON.stringify(notification)]);
              notifications.push([json[1].author, notification]);
            }
            break;
          }
        }
        break;
      }
      case 'account_witness_vote': {
        /** Find witness vote */
        const notification = {
          type: 'witness_vote',
          account: params.account,
          approve: params.approve,
          timestamp: Date.parse(op.timestamp) / 1000,
          block: op.block,
        };
        // console.log('Witness vote', [params.witness, notification]);
        notifications.push([params.witness, notification]);
        break;
      }
      case 'vote': {
        /** Find downvote */
        if (params.weight < 0) {
          const notification = {
            type: 'vote',
            voter: params.voter,
            permlink: params.permlink,
            weight: params.weight,
            timestamp: Date.parse(op.timestamp) / 1000,
            block: op.block,
          };
          // console.log('Downvote', JSON.stringify([params.author, notification]));
          notifications.push([params.author, notification]);
        }
        break;
      }
      case 'transfer': {
        /** Find transfer */
        const notification = {
          type: 'transfer',
          from: params.from,
          amount: params.amount,
          memo: params.memo,
          timestamp: Date.parse(op.timestamp) / 1000,
          block: op.block,
        };
        // console.log('Transfer', JSON.stringify([params.to, notification]));
        notifications.push([params.to, notification]);
        break;
      }
    }
  });
  return notifications;
};

const loadBlock = (blockNum) => {
  console.log(blockNum)
  utils.getOpsInBlock(blockNum, false).then(ops => {
    if (!ops.length) {
      console.error('Block does not exit?', blockNum);
      utils.getBlock(blockNum).then(block => {
        if (block && block.previous && block.transactions.length === 0) {
          console.log('Block exist and is empty, load next', blockNum);
          redis.setAsync('last_block_num', blockNum).then(() => {
            loadNextBlock();
          }).catch(err => {
            console.error('Redis set last_block_num failed', err);
            loadBlock(blockNum);
          });
        } else {
          console.log('Sleep and retry', blockNum);
          utils.sleep(2000).then(() => {
            loadBlock(blockNum);
          });
        }
      }).catch(err => {
        console.log('Error lightrpc (getBlock), sleep and retry', blockNum, JSON.stringify(err));
        utils.sleep(2000).then(() => {
          loadBlock(blockNum);
        });
      });
    } else {
      const notifications = getNotifications(ops);
      
      /** Create redis operations array */
      const redisOps = [];
      if (options.saveRedis) {
        notifications.forEach((notification) => {
          redisOps.push(['lpush', `notifications:${notification[0]}`, JSON.stringify(notification[1])]);
          redisOps.push(['ltrim', `notifications:${notification[0]}`, 0, limit - 1]);
        });
      }
      redisOps.push(['set', 'last_block_num', blockNum]);
      redis.multi(redisOps).execAsync().then(() => {
        console.log('Block loaded', blockNum, 'notification stored', notifications.length);

        /** Send push notification for logged peers */
        notifications.forEach((notification) => {
          wss.clients.forEach((client) => {
            if (client.name && client.name === notification[0]) {
              console.log('Send push notification', notification[0]);
              client.send(JSON.stringify({
                type: 'notification',
                notification: notification[1]
              }));
            }
          });
        });

        loadNextBlock();
      }).catch(err => {
        console.error('Redis store notification multi failed', err);
        loadBlock(blockNum);
      });
    }
  }).catch(err => {
    console.error('Call failed with lightrpc (getOpsInBlock)', err);
    console.log('Retry', blockNum);
    utils.sleep(2000).then(() => {
      loadBlock(blockNum);
    });
  });
};

const loadNextBlock = () => {
  redis.getAsync('last_block_num').then((res) => {
    let nextBlockNum = (res === null)? 20000000 : parseInt(res) + 1;
    utils.getGlobalProps().then(globalProps => {
      const lastIrreversibleBlockNum = globalProps.last_irreversible_block_num;
      if (lastIrreversibleBlockNum >= nextBlockNum) {
        loadBlock(nextBlockNum);
      } else {
        utils.sleep(2000).then(() => {
          console.log('Waiting to be on the lastIrreversibleBlockNum', lastIrreversibleBlockNum, 'now nextBlockNum', nextBlockNum);
          loadNextBlock();
        });
      }
    }).catch(err => {
      console.error('Call failed with lightrpc (getGlobalProps)', err);
      console.log('Retry loadNextBlock');
      loadNextBlock();
    });
  }).catch(err => {
    console.error('Redis get last_block_num failed', err);
  });
};

const start = () => {
  console.info('Start streaming blockchain');
  loadNextBlock();
  // console.info('Pinning random file')
  // ipfs.pin('QmawNzu5sFgLndJ6iqaDGyJYU9Xjgvgiq6Hj7UqwfnWjMR')
  // ipfs.pin('QmX88DJKK94GQE69qcM3YkmTC2DfKHANJWLA94iciwt9qX')

  /** Send heartbeat to peers */
  setInterval(() => {
    wss.clients.forEach((client) => {
      client.send(JSON.stringify({ type: 'heartbeat' }));
    });
  }, 20 * 1000);
};

// redis.flushallAsync();
start();
