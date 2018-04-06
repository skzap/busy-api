const elasticsearch = require('elasticsearch');
const bluebird = require('bluebird');

const client = new elasticsearch.Client({
    host: process.env.ELASTICHOST,
    log: 'trace',
    defer: function() {
        return bluebird.defer();
    }
});

module.exports = client;
