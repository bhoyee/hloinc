'use strict';

const db = require('../db/knex');

const PUBLIC_FIELDS = [
  'id',
  'title',
  'slug',
  'department',
  'location',
  'employment_type',
  'description',
  'requirements',
  'apply_url',
  'published_at',
];

function listPublished() {
  return db('jobs').select(PUBLIC_FIELDS).where({ status: 'published' }).orderBy('published_at', 'desc');
}

function findPublishedBySlug(slug) {
  return db('jobs').select(PUBLIC_FIELDS).where({ status: 'published', slug }).first();
}

module.exports = { listPublished, findPublishedBySlug };
