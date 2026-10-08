'use strict';

/*
 * Media library for the page editor. Uploaded photos are re-encoded with
 * sharp into two WebP sizes (up to 1600px wide, and 560px for phones). Re-
 * encoding also strips hidden data such as camera location, and means only
 * real images are ever saved. Files live in storage/uploads, served at /uploads.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/knex');
const config = require('../config');

const DIR = path.join(config.paths.storage, 'uploads');
const PHOTOS = path.join(config.paths.public, 'img', 'photos');
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Save an uploaded image. Returns the media row, or throws an Error with a friendly message. */
async function save(file, { alt = '', user }) {
  if (!file || !ALLOWED.has(file.mimetype)) throw Object.assign(new Error('Upload a JPG, PNG or WebP photo.'), { status: 422 });
  if (file.size > MAX_BYTES) throw Object.assign(new Error('That photo is over 10 MB. Please use a smaller one.'), { status: 422 });

  const sharp = require('sharp');
  let meta;
  try {
    meta = await sharp(file.buffer).metadata();
  } catch {
    throw Object.assign(new Error('That file isn’t a photo we can read.'), { status: 422 });
  }
  if (!meta.width || !meta.height || meta.width * meta.height > 60e6) throw Object.assign(new Error('That photo is too large to use.'), { status: 422 });

  const name = crypto.randomBytes(8).toString('hex');
  await fs.mkdir(DIR, { recursive: true });
  // .rotate() applies the camera's orientation before the data is stripped.
  const large = await sharp(file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  await sharp(file.buffer).rotate().resize({ width: 560, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(DIR, `${name}-sm.webp`));
  await fs.writeFile(path.join(DIR, `${name}.webp`), large.data);

  const [id] = await db('media').insert({
    file: `${name}.webp`,
    original_name: String(file.originalname || '').slice(0, 200),
    width: large.info.width,
    height: large.info.height,
    bytes: large.data.length,
    alt: String(alt).trim().slice(0, 300) || null,
    uploaded_by: user.id,
  });
  return db('media').where({ id }).first();
}

/** An image value for a page, from a media row. */
function toImage(m) {
  const base = m.file.replace(/\.webp$/, '');
  return { src: `/uploads/${m.file}`, srcSm: `/uploads/${base}-sm.webp`, w: m.width, h: m.height, alt: m.alt || '' };
}

/** Uploaded images (newest first) plus the site's built-in photos. */
async function library() {
  const uploads = (await db('media as m').leftJoin('users as u', 'u.id', 'm.uploaded_by').select('m.*', 'u.name as uploaded_by_name').orderBy('m.id', 'desc').limit(300)).map((m) => ({
    id: m.id,
    kind: 'upload',
    name: m.original_name || m.file,
    by: m.uploaded_by_name,
    at: m.created_at,
    image: toImage(m),
  }));
  let builtIn = [];
  try {
    builtIn = (await fs.readdir(PHOTOS))
      .filter((f) => f.endsWith('.webp') && !f.endsWith('-sm.webp'))
      .sort()
      .map((f) => {
        const slug = f.replace(/\.webp$/, '');
        return { id: `photo:${slug}`, kind: 'built-in', name: slug.replace(/-/g, ' '), image: { src: `/img/photos/${f}`, srcSm: `/img/photos/${slug}-sm.webp`, w: 960, h: 640, alt: '' } };
      });
  } catch {
    builtIn = [];
  }
  return [...uploads, ...builtIn];
}

async function remove(id) {
  const m = await db('media').where({ id }).first();
  if (!m) return null;
  await db('media').where({ id }).del();
  for (const f of [m.file, m.file.replace(/\.webp$/, '-sm.webp')]) {
    await fs.unlink(path.join(DIR, path.basename(f))).catch(() => {});
  }
  return m;
}

module.exports = { save, toImage, library, remove, MAX_BYTES };
