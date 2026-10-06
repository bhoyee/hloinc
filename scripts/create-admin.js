'use strict';

// Creates the first Admin account from the terminal (works over cPanel SSH):
//   npm run create-admin -- --name "Jane Doe" --email jane@hloinc.com
// The password is prompted for and never stored in shell history.

const readline = require('readline');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../src/db/knex');
const { ROLES } = require('../src/auth/permissions');
const { audit } = require('../src/services/audit');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const input = z
    .object({
      name: z.string().trim().min(2, 'Use --name "Full Name"'),
      email: z.string().trim().toLowerCase().email('Use --email with a valid address'),
    })
    .parse({ name: arg('name') || '', email: arg('email') || '' });

  const password = await askHidden('Password (min 12 characters): ');
  if (password.length < 12) throw new Error('Password must be at least 12 characters.');
  if ((await askHidden('Confirm password: ')) !== password) throw new Error('Passwords do not match.');

  if (await db('users').where({ email: input.email }).first()) {
    throw new Error(`An account with ${input.email} already exists.`);
  }

  const [id] = await db('users').insert({
    name: input.name,
    email: input.email,
    password_hash: await bcrypt.hash(password, 12),
    role: ROLES.ADMIN,
    password_changed_at: db.fn.now(),
  });

  await audit(null, {
    action: 'account.create',
    entityType: 'user',
    entityId: id,
    summary: `Admin account ${input.email} created from command line`,
    user: { id, name: input.name },
  });

  console.log(`Admin account created for ${input.email} (id ${id}).`);
}

main()
  .catch((err) => {
    console.error(err.issues ? err.issues.map((i) => i.message).join('\n') : err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
