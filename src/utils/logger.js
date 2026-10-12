const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

const { combine, timestamp, json, colorize, simple } = winston.format;

const transactionFile = new winston.transports.DailyRotateFile({
  dirname: path.resolve(config.logDir),
  filename: 'transactions-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  maxSize: '20m',
});

const errorFile = new winston.transports.DailyRotateFile({
  dirname: path.resolve(config.logDir),
  filename: 'errors-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxFiles: '30d',
});

const logger = winston.createLogger({
  level: 'info',
  format: combine(timestamp(), json()),
  transports: [
    transactionFile,
    errorFile,
    new winston.transports.Console({ format: combine(colorize(), simple()) }),
  ],
});

// Helper for business events: connect, join, message, and so on.
logger.transaction = (event, data = {}) => logger.info(event, { event, ...data });

module.exports = logger;
