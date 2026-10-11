'use strict';

/**
 * Staff profile photos. Uploads are checked and re-encoded with sharp into a
 * 256×256 WebP (which also strips hidden data such as camera location), and kept
 * in storage/avatars, outside the public folders: they're served only to signed-in
 * staff, by /portal/avatars/:id.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/knex');
const config = require('../config');

const DIR = path.join(config.paths.storage, 'avatars');
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const NAME = /^[a-f0-9]{32}\.webp$/;

const problem = (message) => Object.assign(new Error(message), { status: 422 });

/** Save a new photo for this person (replacing any old one). Returns the file name. */
async function save(userId, file) {
  if (!file || !file.buffer || !file.size) throw problem('Choose a photo to upload.');
  if (!ALLOWED.has(file.mimetype)) throw problem('Upload a JPG, PNG or WebP photo.');
  if (file.size > MAX_BYTES) throw problem('That photo is over 5 MB. Please choose a smaller one.');
  const sharp = require('sharp');
  let meta;
  try {
    meta = await sharp(file.buffer).metadata();
  } catch {
    throw problem('That file isn’t a photo we can read.');
  }
  if (!meta.width || !meta.height || meta.width * meta.height > 60e6) throw problem('That photo is too large to use.');

  const name = `${crypto.randomBytes(16).toString('hex')}.webp`;
  await fs.mkdir(DIR, { recursive: true });
  // .rotate() applies the camera's orientation; the square crop centres on the most interesting part.
  await sharp(file.buffer).rotate().resize(256, 256, { fit: 'cover', position: sharp.strategy.attention }).webp({ quality: 82 }).toFile(path.join(DIR, name));
  const old = await db('users').where({ id: userId }).first('avatar');
  await db('users').where({ id: userId }).update({ avatar: name });
  if (old && old.avatar) await removeFile(old.avatar);
  return name;
}

async function remove(userId) {
  const row = await db('users').where({ id: userId }).first('avatar');
  await db('users').where({ id: userId }).update({ avatar: null });
  if (row && row.avatar) await removeFile(row.avatar);
}

const removeFile = (name) => (NAME.test(name) ? fs.rm(path.join(DIR, name), { force: true }) : null);

/** Full path of a stored photo, or null. */
const fileFor = (name) => (NAME.test(String(name)) ? path.join(DIR, name) : null);

const { initials, color } = require('../lib/avatar');

module.exports = { save, remove, fileFor, initials, color, MAX_BYTES };
