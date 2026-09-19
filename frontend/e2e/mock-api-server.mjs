import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number(process.env.E2E_API_PORT || 3001);

const ORIGIN = { lat: 43.0000, lng: -78.0000 };
const DESTINATION = { lat: 43.0018, lng: -78.0000 };

const routeFixture = {
  provider: 'osrm',
  duration_seconds: 120,
  distance_meters: 1800,
  segments: [{
    coords: [
      { lat: 43.0000, lng: -78.0000, alt: 0 },
      { lat: 43.0007, lng: -78.0000, alt: 0 },
      { lat: 43.0012, lng: -78.0000, alt: 0 },
      { lat: 43.0018, lng: -78.0000, alt: 0 },
    ],
    is_highlighted: true,
    color: '#2D7FF9',
    lane_index: null,
  }],
  maneuvers: [{
    type: 'arrive',
    modifier: null,
    location: DESTINATION,
    bearing_before: 0,
    instruction: 'Arrive at destination',
    is_complex: false,
  }],
};

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Guest-ID, X-Client-Request-ID',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(payload);
};

const readBody = (req) => new Promise((resolve) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => resolve(body));
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname === '/ready' || url.pathname === '/health') {
    return json(res, 200, { success: true, status: 'ok' });
  }

  if (!url.pathname.startsWith('/api/')) {
    return json(res, 404, { success: false, error: { message: 'Not found' } });
  }

  const path = url.pathname.slice('/api'.length);

  if (path === '/geocode') {
    return json(res, 200, {
      success: true,
      data: [{ display_name: 'Test Destination, Streept', location: DESTINATION }],
    });
  }

  if (path === '/route') {
    return json(res, 200, { success: true, data: { routes: [routeFixture] } });
  }

  if (
    path === '/parking' ||
    path === '/parking/cars' ||
    path === '/parked-cars' ||
    path === '/reports' ||
    path === '/billboards' ||
    path === '/traffic' ||
    path === '/traffic/vehicles' ||
    path === '/scene-context'
  ) {
    return json(res, 200, { success: true, data: [] });
  }

  if (path === '/ws') {
    return json(res, 426, { success: false, error: { message: 'WebSocket not available in E2E mock' } });
  }

  if (req.method === 'POST') {
    await readBody(req);
    return json(res, 200, { success: true, data: {} });
  }

  return json(res, 200, { success: true, data: [] });
});

server.listen(PORT, HOST, () => {
  console.log(`Streept E2E mock API listening on http://${HOST}:${PORT}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
