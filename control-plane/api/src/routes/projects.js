const express = require('express');
const db = require('../db');
const { jwtAuth } = require('../middleware/jwtAuth');

const router = express.Router();
router.use(jwtAuth);

router.get('/', async (_req, res) => {
  const projects = await db('projects')
    .leftJoin('agents', 'projects.agent_id', 'agents.id')
    .select('projects.*', 'agents.slug as agent_slug', 'agents.name as agent_name')
    .orderBy('projects.name', 'asc');

  const ids = projects.map((p) => p.id);
  const repos = ids.length
    ? await db('project_repos').whereIn('project_id', ids).orderBy(['project_id', 'host'])
    : [];
  const byProject = new Map();
  for (const r of repos) {
    if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
    byProject.get(r.project_id).push(r);
  }
  for (const p of projects) p.repos = byProject.get(p.id) || [];

  res.json({ projects });
});

router.get('/:slug', async (req, res) => {
  const p = await db('projects')
    .leftJoin('agents', 'projects.agent_id', 'agents.id')
    .select('projects.*', 'agents.slug as agent_slug', 'agents.name as agent_name')
    .where('projects.slug', req.params.slug)
    .first();
  if (!p) return res.status(404).json({ error: 'not_found' });
  p.repos = await db('project_repos').where({ project_id: p.id }).orderBy('host');
  res.json({ project: p });
});

module.exports = router;
