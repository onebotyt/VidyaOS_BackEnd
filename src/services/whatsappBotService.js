/**
 * Self-Hosted Institutional WhatsApp Web Bot Service (Option 2)
 * Powered by whatsapp-web.js with LocalAuth & Chromium
 * 
 * Provides:
 * - 100% Free / Zero-Cost WhatsApp OTP delivery directly from college phone/SIM
 * - Automated session persistence in whatsapp_session/
 * - Real-time QR Code generation for Admin scan (Linked Devices)
 * - Safe fallback to direct links/scan cards when bot is unlinked
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

function removeLockfiles(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    const lockFiles = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const f of lockFiles) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (_) {}
      }
    }
  } catch (_) {}
}

function clearSessionDirectory(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    logger.warn(`[WHATSAPP BOT] Could not completely remove session dir: ${e.message}`);
  }
}

class WhatsAppBotService {
  constructor() {
    this.client = null;
    this.state = {
      status: 'DISCONNECTED', // 'DISCONNECTED' | 'INITIALIZING' | 'QR_READY' | 'AUTHENTICATED' | 'CONNECTED'
      qrRaw: null,
      qrDataUrl: null,
      connectedUser: null,
      lastError: null,
      startedAt: null
    };
    this.isInitializing = false;
    this.initTimeout = null;
  }

  /**
   * Initializes the WhatsApp Web Bot
   * Resolves Chromium from Playwright/System and attaches event listeners
   */
  async initialize({ clearSession = false } = {}) {
    if (this.state.status === 'CONNECTED' && this.client) {
      return { success: true, message: 'WhatsApp Bot is already connected', status: this.state.status };
    }

    // If an existing client was created or left running, properly destroy it first
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (_) {}
      this.client = null;
    }

    if (this.initTimeout) {
      clearTimeout(this.initTimeout);
      this.initTimeout = null;
    }

    this.isInitializing = true;
    this.state.status = 'INITIALIZING';
    this.state.lastError = null;
    this.state.qrRaw = null;
    this.state.qrDataUrl = null;
    this.state.startedAt = new Date().toISOString();

    const sessionDir = process.env.WHATSAPP_SESSION_DIR
      ? (path.isAbsolute(process.env.WHATSAPP_SESSION_DIR) ? process.env.WHATSAPP_SESSION_DIR : path.resolve(process.cwd(), process.env.WHATSAPP_SESSION_DIR))
      : path.resolve(__dirname, '../../whatsapp_session');

    const sessionPath = path.join(sessionDir, 'session');

    if (clearSession) {
      clearSessionDirectory(sessionPath);
      logger.info('[WHATSAPP BOT] Cleared session cache for fresh pairing QR.');
    } else {
      removeLockfiles(sessionPath);
      removeLockfiles(path.join(sessionPath, 'Default'));
    }

    try {
      // Resolve Chromium executable path: prioritize environment variable, then Playwright
      let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      if (!executablePath) {
        try {
          const { chromium } = require('playwright');
          executablePath = chromium.executablePath();
        } catch (err) {
          logger.warn('[WHATSAPP BOT] Playwright chromium not found, relying on default puppeteer browser');
        }
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: sessionDir
        }),
        puppeteer: {
          headless: true,
          executablePath: executablePath || undefined,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions'
          ]
        }
      });

      this._attachEventHandlers();

      // Failsafe timeout: 45 seconds maximum for QR generation
      this.initTimeout = setTimeout(async () => {
        if (this.isInitializing && this.state.status === 'INITIALIZING') {
          logger.warn('[WHATSAPP BOT] Initialization timed out after 45s');
          this.isInitializing = false;
          this.state.status = 'DISCONNECTED';
          this.state.lastError = 'QR generation timed out. Click "Fresh QR (Clear Session)" to reset.';
          if (this.client) {
            try { await this.client.destroy(); } catch (_) {}
            this.client = null;
          }
        }
      }, 45000);

      // Launch in background without blocking
      this.client.initialize().catch(async (err) => {
        if (this.initTimeout) {
          clearTimeout(this.initTimeout);
          this.initTimeout = null;
        }
        logger.error(`[WHATSAPP BOT] Client initialize error: ${err.message}`);
        this.state.status = 'DISCONNECTED';
        this.state.lastError = err.message;
        this.isInitializing = false;
        if (this.client) {
          try { await this.client.destroy(); } catch (_) {}
          this.client = null;
        }
      });

      return {
        success: true,
        message: 'WhatsApp Bot initialization started. Scan QR code when ready.',
        status: this.state.status
      };
    } catch (err) {
      this.isInitializing = false;
      this.state.status = 'DISCONNECTED';
      this.state.lastError = err.message;
      logger.error(`[WHATSAPP BOT] Initialization failed: ${err.message}`);
      return { success: false, message: err.message, status: this.state.status };
    }
  }

  _attachEventHandlers() {
    if (!this.client) return;

    this.client.on('qr', async (qr) => {
      if (this.initTimeout) {
        clearTimeout(this.initTimeout);
        this.initTimeout = null;
      }
      this.state.qrRaw = qr;
      this.isInitializing = false;
      try {
        this.state.qrDataUrl = await qrcode.toDataURL(qr, { margin: 2, scale: 6 });
      } catch (err) {
        logger.warn(`[WHATSAPP BOT] QR DataURL conversion warning: ${err.message}`);
        this.state.qrDataUrl = null;
      }
      this.state.status = 'QR_READY';
      this.state.lastError = null;
      logger.info('[WHATSAPP BOT] >>> Scan QR code via WhatsApp -> Settings -> Linked Devices <<<');
    });

    this.client.on('authenticated', () => {
      if (this.initTimeout) {
        clearTimeout(this.initTimeout);
        this.initTimeout = null;
      }
      this.state.status = 'AUTHENTICATED';
      this.state.lastError = null;
      this.isInitializing = false;
      logger.info('[WHATSAPP BOT] Client authenticated successfully');
    });

    this.client.on('ready', () => {
      if (this.initTimeout) {
        clearTimeout(this.initTimeout);
        this.initTimeout = null;
      }
      this.state.status = 'CONNECTED';
      this.state.qrRaw = null;
      this.state.qrDataUrl = null;
      this.state.lastError = null;
      this.isInitializing = false;

      const info = this.client.info || {};
      const botPhone = info.wid?.user || '';
      this.state.connectedUser = {
        phone: botPhone || 'Connected Phone',
        pushname: info.pushname || 'Institutional WhatsApp',
        platform: info.platform || 'whatsapp'
      };

      if (botPhone) {
        try {
          const { query } = require('../config/db');
          query(
            `INSERT INTO system_settings (setting_key, setting_value, description, updated_by, updated_at)
             VALUES ('whatsapp_gateway_phone', ?, 'Institutional Admin WhatsApp phone number linked in gateway', 1, CURRENT_TIMESTAMP)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`,
            [botPhone]
          ).catch(e => logger.warn(`[WHATSAPP BOT] Could not persist connected phone: ${e.message}`));
        } catch (_) {}
      }

      logger.info(`[WHATSAPP BOT] 🟢 WhatsApp Bot READY! Connected: +${this.state.connectedUser.phone} (${this.state.connectedUser.pushname})`);
    });

    // Auto-respond to incoming student verification messages or OTP queries
    this.client.on('message', async (msg) => {
      try {
        if (!msg || !msg.body || msg.fromMe) return;
        const sender = msg.from ? msg.from.replace('@c.us', '') : '';
        if (!sender) return;

        let cleanSender = sender;
        if (cleanSender.startsWith('91') && cleanSender.length === 12) {
          cleanSender = cleanSender.slice(2);
        }

        const { query } = require('../config/db');
        const rows = await query(
          `SELECT * FROM otp_verifications 
           WHERE identifier = ? AND is_verified = 0 AND expires_at > datetime('now')
           ORDER BY id DESC LIMIT 1`,
          [cleanSender]
        );

        if (rows && rows.length > 0) {
          const rec = rows[0];
          const replyText = `🔐 Government Polytechnic College: Your One-Time Password (OTP) for Registration Verification is: *${rec.otp_code}*. Valid for 5 minutes. Do not share this code with anyone.`;
          await msg.reply(replyText);
          logger.info(`[WHATSAPP BOT] Auto-replied with active OTP to +${sender}`);
        } else {
          const bodyLower = (msg.body || '').toLowerCase();
          if (bodyLower.includes('otp') || bodyLower.includes('verify') || bodyLower.includes('register') || bodyLower.includes('vidyaos')) {
            await msg.reply(`👋 Government Polytechnic College Institutional Gateway:\n\nIf you are verifying your account on VidyaOS, please enter your mobile (+91 ${cleanSender}) on the registration portal and tap "Send OTP". Your code will be dispatched here immediately.`);
          }
        }
      } catch (err) {
        logger.warn(`[WHATSAPP BOT] Incoming message listener warning: ${err.message}`);
      }
    });

    this.client.on('auth_failure', async (msg) => {
      if (this.initTimeout) {
        clearTimeout(this.initTimeout);
        this.initTimeout = null;
      }
      this.state.status = 'DISCONNECTED';
      this.state.lastError = `Authentication failed: ${msg}. Click "Fresh QR" to regenerate.`;
      this.state.qrRaw = null;
      this.state.qrDataUrl = null;
      this.isInitializing = false;
      logger.error(`[WHATSAPP BOT] Authentication failed: ${msg}`);
      if (this.client) {
        try { await this.client.destroy(); } catch (_) {}
        this.client = null;
      }
    });

    this.client.on('disconnected', async (reason) => {
      if (this.initTimeout) {
        clearTimeout(this.initTimeout);
        this.initTimeout = null;
      }
      this.state.status = 'DISCONNECTED';
      this.state.lastError = `Bot disconnected (${reason}). Click "Link Bot" to reconnect.`;
      this.state.qrRaw = null;
      this.state.qrDataUrl = null;
      this.state.connectedUser = null;
      this.isInitializing = false;
      logger.warn(`[WHATSAPP BOT] WhatsApp Bot disconnected: ${reason}`);
      if (this.client) {
        try { await this.client.destroy(); } catch (_) {}
        this.client = null;
      }
    });
  }

  /**
   * Returns connected bot phone number or null
   */
  getConnectedPhone() {
    if (this.state.connectedUser && this.state.connectedUser.phone && this.state.connectedUser.phone !== 'Connected Phone') {
      return this.state.connectedUser.phone;
    }
    return null;
  }

  /**
   * Check if bot is active and ready to dispatch
   */
  isConnected() {
    return this.state.status === 'CONNECTED' && this.client !== null;
  }

  /**
   * Get current connection telemetry & QR code image
   */
  getStatus() {
    return {
      status: this.state.status,
      is_connected: this.state.status === 'CONNECTED',
      is_qr_ready: this.state.status === 'QR_READY',
      qr_code_url: this.state.qrDataUrl,
      connected_user: this.state.connectedUser,
      last_error: this.state.lastError,
      started_at: this.state.startedAt
    };
  }

  /**
   * Send WhatsApp message directly to Indian / international phone number
   */
  async sendMessage(phone, messageText) {
    if (!this.isConnected()) {
      return { success: false, reason: 'BOT_NOT_CONNECTED', status: this.state.status };
    }

    let cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
      // already formatted with 91
    } else if (cleanPhone.length === 10) {
      cleanPhone = `91${cleanPhone}`;
    }

    const chatId = `${cleanPhone}@c.us`;

    try {
      const result = await this.client.sendMessage(chatId, messageText);
      logger.info(`[WHATSAPP BOT] Direct message dispatched to +${cleanPhone}`);
      return {
        success: true,
        delivered: true,
        messageId: result.id?._serialized,
        channel: 'WHATSAPP_BOT'
      };
    } catch (err) {
      logger.error(`[WHATSAPP BOT] Failed to dispatch to +${cleanPhone}: ${err.message}`);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Disconnect and destroy current WhatsApp session
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (_) {}
      this.client = null;
    }
    this.state.status = 'DISCONNECTED';
    this.state.qrRaw = null;
    this.state.qrDataUrl = null;
    this.state.connectedUser = null;
    this.isInitializing = false;
    return { success: true, message: 'WhatsApp Bot disconnected' };
  }
}

module.exports = new WhatsAppBotService();
