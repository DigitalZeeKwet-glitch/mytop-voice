import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Use memory store as fallback when DATABASE_URL is not configured or in case database connection fails.
class MemoryDB {
  constructor() {
    this.store = {};
  }

  async init() {
    console.log('[MemoryDB] Initializing in-memory VIP users store...');
    this.importFromEnv();
  }

  importFromEnv() {
    let imported = 0;
    // Load standard default user first
    this.store['000123'] = '2026-12-15';

    if (process.env.VIP_USERS) {
      try {
        const envUsers = JSON.parse(process.env.VIP_USERS);
        for (const [password, expiry] of Object.entries(envUsers)) {
          // Expiry validation: check if date is valid format YYYY-MM-DD
          if (password && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
            this.store[password] = expiry;
            imported++;
          }
        }
        console.log(`[MemoryDB] Successfully imported ${imported} VIP users from env.`);
      } catch (err) {
        console.error('[MemoryDB] Failed to parse VIP_USERS environment variable. Using defaults.', err);
      }
    }
  }

  async getAllUsers() {
    return Object.entries(this.store).map(([password, expiry]) => ({
      password,
      expiry_date: expiry
    }));
  }

  async getUser(password) {
    if (Object.prototype.hasOwnProperty.call(this.store, password)) {
      return { password, expiry_date: this.store[password] };
    }
    return null;
  }

  async addUser(password, expiryDate) {
    this.store[password] = expiryDate;
    return { password, expiry_date: expiryDate };
  }

  async updateUser(password, expiryDate) {
    this.store[password] = expiryDate;
    return { password, expiry_date: expiryDate };
  }

  async deleteUser(password) {
    const exists = Object.prototype.hasOwnProperty.call(this.store, password);
    delete this.store[password];
    return exists;
  }
}

let dbInstance = null;

if (process.env.DATABASE_URL) {
  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false } // Required for Render/Neon hosted PostgreSQL
    });

    dbInstance = {
      isPostgres: true,
      pool,
      async query(text, params) {
        return pool.query(text, params);
      },
      async init() {
        console.log('[PostgresDB] Connecting to database and running migrations...');
        // Create VIP users table if it does not exist
        await this.query(`
          CREATE TABLE IF NOT EXISTS vip_users (
            password VARCHAR(255) PRIMARY KEY,
            expiry_date DATE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('[PostgresDB] Table verified.');

        // Attempt VIP_USERS import
        const countRes = await this.query('SELECT COUNT(*) FROM vip_users');
        const count = parseInt(countRes.rows[0].count, 10);
        if (count === 0) {
          console.log('[PostgresDB] Table is empty, performing VIP_USERS env import...');
          let imported = 0;
          // Seed initial user
          try {
            await this.query('INSERT INTO vip_users (password, expiry_date) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['000123', '2026-12-15']);
            imported++;
          } catch (e) {
            console.error('[PostgresDB] Seeding default user failed', e);
          }

          if (process.env.VIP_USERS) {
            try {
              const envUsers = JSON.parse(process.env.VIP_USERS);
              for (const [password, expiry] of Object.entries(envUsers)) {
                if (password && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
                  await this.query('INSERT INTO vip_users (password, expiry_date) VALUES ($1, $2) ON CONFLICT DO NOTHING', [password, expiry]);
                  imported++;
                }
              }
              console.log(`[PostgresDB] Successfully imported ${imported} VIP users into PostgreSQL.`);
            } catch (err) {
              console.error('[PostgresDB] Failed to parse VIP_USERS env variable.', err);
            }
          }
        }
      },
      async getAllUsers() {
        const res = await this.query('SELECT password, TO_CHAR(expiry_date, \'YYYY-MM-DD\') as expiry_date FROM vip_users ORDER BY created_at DESC');
        return res.rows;
      },
      async getUser(password) {
        const res = await this.query('SELECT password, TO_CHAR(expiry_date, \'YYYY-MM-DD\') as expiry_date FROM vip_users WHERE password = $1', [password]);
        return res.rows[0] || null;
      },
      async addUser(password, expiryDate) {
        const res = await this.query(
          'INSERT INTO vip_users (password, expiry_date) VALUES ($1, $2) RETURNING password, TO_CHAR(expiry_date, \'YYYY-MM-DD\') as expiry_date',
          [password, expiryDate]
        );
        return res.rows[0];
      },
      async updateUser(password, expiryDate) {
        const res = await this.query(
          'UPDATE vip_users SET expiry_date = $2 WHERE password = $1 RETURNING password, TO_CHAR(expiry_date, \'YYYY-MM-DD\') as expiry_date',
          [password, expiryDate]
        );
        return res.rows[0];
      },
      async deleteUser(password) {
        const res = await this.query('DELETE FROM vip_users WHERE password = $1 RETURNING password', [password]);
        return res.rowCount > 0;
      }
    };
  } catch (error) {
    console.error('[PostgresDB] Connection creation failed. Falling back to MemoryDB.', error);
    dbInstance = new MemoryDB();
  }
} else {
  console.log('[PostgresDB] DATABASE_URL not set. Using MemoryDB.');
  dbInstance = new MemoryDB();
}

export default dbInstance;
