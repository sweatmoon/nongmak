module.exports = {
  apps: [{
    name: 'agri-backend',
    script: 'python',
    args: '-m uvicorn app.main:app --host 0.0.0.0 --port 8000',
    cwd: '/home/user/webapp/backend',
    interpreter: 'none',
    env: { PYTHONPATH: '/home/user/webapp/backend' }
  }]
}
