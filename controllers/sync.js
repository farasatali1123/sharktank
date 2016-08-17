﻿'use strict';

const Calibrate = require('calibrate');
const Joi = require('joi');
const async = require('async');
const Boom = require('boom');

const moment = require('moment');

const CassandraDriver = require('cassandra-driver');
const Cassandra = require('../common/cassandra');
const TimeUuid = CassandraDriver.types.TimeUuid;

// The follow docs says use a single client object per app
// https://docs.datastax.com/en/developer/nodejs-driver/2.0/nodejs-driver/reference/threeSimpleRules.html
const client = Cassandra.getClient();

const syncController = {

    post: function (request, reply) {

        // Context is a container for everything needed for this request to be processed
        var context = {
            client: client,
            requestStartMoment: moment(),
            request: request,
            response: {
                groups: []
            }
        };

        // First check its a valid app id / app key
        syncController.checkAccount(context)
            .then(application => {
                // Grab the device record and update the last seen
                return syncController.checkDevice(context)
            })
            .then(device => {
                context.response.sync_id = device.device.sync_id

                // Then process all the changes from the client
                return syncController.processClientChanges(context);
            })
            .then(timeUUIDs => {
                // The results from the previous calls should be a list of timeUUIDs 
                // for the records just inserted, don't want to send them back the client

                // Then fire all the group queries and update the device table
                return Promise.all(syncController.getQueries(context));
            })
            .then(results => {
                // If all that worked, format a return response
                return reply(syncController.formatResponse(context, results));
            })
            .catch(err => {
                // If any of them died, return an error for it
                return reply(Calibrate.error(err));
            });

    },

    checkAccount: function (context) {
        return new Promise(function (resolve, reject) {

            const query = 'SELECT * FROM application WHERE app_id = ? AND app_api_access_key = ?';
            const params = [context.request.payload.app_id, context.request.payload.app_api_access_key];

            context.client.execute(query, params, { prepare: true }, function (err, result) {

                if (err) {
                    return reject(err);
                }

                if (result.rows.length == 0) {
                    return reject(Calibrate(Boom.unauthorized('app_id or app_api_access_key incorrect')));
                }

                resolve(result.rows[0]);
            });

        });
    },

    checkDevice: function (context) {
        return new Promise(function (resolve, reject) {
            const deviceId = context.request.payload.device_id;

            const query = 'SELECT * FROM device WHERE device_id = ?';
            const params = [deviceId];

            context.client.execute(query, params, { prepare: true }, function (err, result) {

                if (err) {
                    return reject(err);
                }

                if (result.rows.length == 0) {
                    return reject(Boom.notFound('device_id not found'));
                }

                const updateStatement = 'UPDATE device SET last_seen = dateof(now()) WHERE device_id = ?';
                const params = [deviceId];
                const deviceRecord = result.rows[0];

                context.client.execute(updateStatement, params, { prepare: true }, function (err, result) {

                    if (err) {
                        return reject(err);
                    }

                    resolve({ device: deviceRecord });

                });

            });

        });
    },

    processClientChanges: function (context) {
        return new Promise(function (resolve, reject) {

            var inserts = [];
            const timeUUIDs = [];
            const appId = context.request.payload.app_id;
            const deviceId = context.request.payload.device_id;
            const requestStartMoment = context.requestStartMoment;

            for (var group of context.request.payload.groups) {

                for (var change of group.changes) {

                    const recordId = change.path.substring(0, change.path.indexOf("/"));
                    const date = requestStartMoment.subtract(change.secondsAgo, 'seconds').toDate();
                    const timeuuid = TimeUuid.fromDate(date);

                    inserts.push({
                        query: 'INSERT INTO change (app_id, rec_id, path, group, modified, value, device_id) VALUES (?,?,?,?,?,?,?)',
                        params: [appId, recordId, change.path, group.group, timeuuid, change.value, deviceId]
                    });

                    // Return the time GUID for this new record so we change use it to skip returning these same values
                    timeUUIDs.push(timeuuid.toString());

                    if (inserts.length > 20) {
                        context.client.batch(inserts, { prepare: true }, function (err) {
                            if (err) {
                                return reject(err);
                            }
                        });

                        // Reset the array for the next inserts
                        inserts = [];
                    }

                }

            }

            if (inserts.length > 0) {
                context.client.batch(inserts, { prepare: true }, function (err) {
                    if (err) {
                        return reject(err);
                    }

                    return resolve(timeUUIDs);
                });
            }
            else {
                return resolve(timeUUIDS);
            }
        });
    },

    getQueries: function (context) {

        const appId = context.request.payload.app_id;
        const queries = [];

        // Work out changes for each group
        for (var group of context.request.payload.groups) {
            queries.push(syncController.queryChangesForGroup(context.client, appId, group.group, group.tidemark));
        }

        return queries;
    },

    queryChangesForGroup: function (client, appId, group, tidemark) {
        return new Promise(function (resolve, reject) {

            const eventualConsistancyBufferDate = moment().subtract(1, "seconds").toDate();
            const eventualConsistancyBufferTimeUUID = TimeUuid.fromDate(eventualConsistancyBufferDate);

            var query = "SELECT * FROM change WHERE app_id = ? AND group = ? AND modified < ?";
            var params = [appId, group, eventualConsistancyBufferTimeUUID];

            if (tidemark != "" && tidemark != undefined) {

                query += " AND modified > ?";
                params.push(tidemark);
            }

            query += " LIMIT 20";

            client.execute(query, params, { prepare: true }, function (err, result) {

                if (err) {
                    return reject(err);
                }

                //var filteredResults = [];

                //// Don't return any records that we just inserted
                //if (timeUUIDs != undefined && timeUUIDs.length > 0 && result.rows.length > 0) {
                //    for (var row of result.rows) {
                //        if (timeUUIDs.indexOf(row.modified.toString()) == -1)
                //            filteredResults.push(row);
                //    }
                //}
                //else {
                //    filteredResults = result.rows;
                //}

                resolve({ group: group, changes: result.rows });
            });
        });
    },

    formatResponse: function (context, results) {

        for (var result of results) {

            if (result.group != undefined) {

                var groupResponse = {
                    group: result.group,
                    changes: []
                }

                for (var change of result.changes) {
                    groupResponse.changes.push({
                        path: change.path,
                        value: change.value,
                        timestamp: change.modified
                    });
                }

                context.response.groups.push(groupResponse);
            }
        }

        return Calibrate.response(context.response);
    }
};

exports.controller = syncController;

exports.register = function (server, options, next) {

    server.route({
        method: "POST",
        path: "/sync",
        handler: syncController.post,
        config: {
            validate: {
                payload: {
                    app_id: Joi.string().guid().required(),
                    app_api_access_key: Joi.string().guid().required(),
                    device_id: Joi.string().guid().required(),
                    groups: Joi.array().items(Joi.object({
                        group: Joi.string().required(),
                        tidemark: [Joi.string().guid(), Joi.string().empty(''), Joi.allow(null)],
                        changes: Joi.array().items(Joi.object({
                            path: Joi.string().required(),
                            value: Joi.string().required(),
                            secondsAgo: Joi.number().required()
                        }))
                    }))
                }
            }
        }
    });

    next();
};

exports.register.attributes = {
    pkg: {
        "name": "sync",
        "version": "0.0.1",
        "description": "",
        "main": "sync.js"
    }
}