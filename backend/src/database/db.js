const knex = require('knex');
const config = require('../config/knexfile');

const db = knex(config);
module.exports = db;
