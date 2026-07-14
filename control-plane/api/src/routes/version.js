// Version — surfaces the version-check skill's result so the dashboard can show
// an "update available" banner. Reads the agentv_meta rows the nightly
// version-check cron writes. Public (no auth): version numbers aren't sensitive
// and the banner should render regardless of auth state.
const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /v1/version — { current, latest, branch, behind, checkedAt, error, updateAvailable }
router.get('/', async (_req, res) => {
  try {
    const rows = await db('agentv_meta')
      .whereIn('k', [
        'version_current', 'version_latest', 'version_branch',
        'version_behind', 'version_checked_at', 'version_error',
      ])
      .select('k', 'v');
    const m = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    const behind = parseInt(m.version_behind || '0', 10) || 0;
    res.json({
      current: m.version_current || null,
      latest: m.version_latest || null,
      branch: m.version_branch || null,
      behind,
      checkedAt: m.version_checked_at || null,
      error: m.version_error || null,
      updateAvailable: behind > 0,
    });
  } catch (err) {
    // Table missing (pre-migration) or DB down — the banner just stays hidden.
    console.error('version_meta_error', err.message);
    res.json({ current: null, latest: null, branch: null, behind: 0, checkedAt: null, error: 'unavailable', updateAvailable: false });
  }
});

module.exports = router;
