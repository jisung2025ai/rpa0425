const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── 미들웨어 ──────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── PostgreSQL 연결 ───────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ── DB 초기화 ─────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(200),
        phone VARCHAR(50),

        -- 앱 설치 체크
        app_claude BOOLEAN DEFAULT false,
        app_notebooklm BOOLEAN DEFAULT false,
        app_capcut BOOLEAN DEFAULT false,
        app_gamma BOOLEAN DEFAULT false,
        app_clipsai BOOLEAN DEFAULT false,
        app_chrome BOOLEAN DEFAULT false,

        -- 자동화 업무 1
        task1_name TEXT,
        task1_current TEXT,
        task1_pain TEXT,
        task1_tool VARCHAR(50),

        -- 자동화 업무 2
        task2_name TEXT,
        task2_current TEXT,
        task2_pain TEXT,
        task2_tool VARCHAR(50),

        -- 자동화 업무 3
        task3_name TEXT,
        task3_current TEXT,
        task3_pain TEXT,
        task3_tool VARCHAR(50),

        -- 실습 소재
        material_nb_docs TEXT,
        material_nb_goal TEXT,
        material_cc_files TEXT,
        material_cc_output VARCHAR(100),

        -- 체크리스트
        check_laptop BOOLEAN DEFAULT false,
        check_chrome BOOLEAN DEFAULT false,
        check_login BOOLEAN DEFAULT false,
        check_video BOOLEAN DEFAULT false,
        check_pdf BOOLEAN DEFAULT false,
        check_worksheet BOOLEAN DEFAULT false,
        check_tasks BOOLEAN DEFAULT false,

        -- 목표
        personal_goal TEXT,

        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        ip_address VARCHAR(50),
        user_agent TEXT
      );
    `);
    console.log('✅ DB 초기화 완료');
  } finally {
    client.release();
  }
}

// ── API: 제출 ─────────────────────────────────────────────────
app.post('/api/submit', async (req, res) => {
  try {
    const d = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    const result = await pool.query(`
      INSERT INTO submissions (
        name, email, phone,
        app_claude, app_notebooklm, app_capcut, app_gamma, app_clipsai, app_chrome,
        task1_name, task1_current, task1_pain, task1_tool,
        task2_name, task2_current, task2_pain, task2_tool,
        task3_name, task3_current, task3_pain, task3_tool,
        material_nb_docs, material_nb_goal, material_cc_files, material_cc_output,
        check_laptop, check_chrome, check_login, check_video, check_pdf, check_worksheet, check_tasks,
        personal_goal, ip_address, user_agent
      ) VALUES (
        $1,$2,$3,
        $4,$5,$6,$7,$8,$9,
        $10,$11,$12,$13,
        $14,$15,$16,$17,
        $18,$19,$20,$21,
        $22,$23,$24,$25,
        $26,$27,$28,$29,$30,$31,$32,
        $33,$34,$35
      ) RETURNING id
    `, [
      d.name || null, d.email || null, d.phone || null,
      !!d.app_claude, !!d.app_notebooklm, !!d.app_capcut,
      !!d.app_gamma, !!d.app_clipsai, !!d.app_chrome,
      // [FIX #8] task_name이 비었으면 tool도 null로 저장
      d.task1_name || null, d.task1_current || null, d.task1_pain || null,
      d.task1_name ? (d.task1_tool || null) : null,
      d.task2_name || null, d.task2_current || null, d.task2_pain || null,
      d.task2_name ? (d.task2_tool || null) : null,
      d.task3_name || null, d.task3_current || null, d.task3_pain || null,
      d.task3_name ? (d.task3_tool || null) : null,
      d.material_nb_docs || null, d.material_nb_goal || null,
      d.material_cc_files || null, d.material_cc_output || null,
      !!d.check_laptop, !!d.check_chrome, !!d.check_login,
      !!d.check_video, !!d.check_pdf, !!d.check_worksheet, !!d.check_tasks,
      d.personal_goal || null,
      ip.substring(0, 50), ua.substring(0, 500)
    ]);

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('제출 오류:', err);
    res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
});

// ── API: 통계 ─────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) as cnt FROM submissions');
    const totalCount = parseInt(total.rows[0].cnt);

    // [FIX #2] total=0일 때도 모든 필드를 포함한 구조 반환
    if (totalCount === 0) {
      return res.json({
        total: 0,
        apps: {
          claude: 0, notebooklm: 0, capcut: 0, gamma: 0, clipsai: 0, chrome: 0,
          claude_n: 0, notebooklm_n: 0, capcut_n: 0, gamma_n: 0, clipsai_n: 0, chrome_n: 0
        },
        tools: [],
        ccOutput: [],
        checklist: { laptop: 0, chrome: 0, login: 0, video: 0, pdf: 0, worksheet: 0, tasks: 0 },
        timeline: [],
        recent: [],
        goals: []
      });
    }

    // 앱 설치 현황
    const apps = await pool.query(`
      SELECT
        ROUND(SUM(CASE WHEN app_claude THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as claude,
        ROUND(SUM(CASE WHEN app_notebooklm THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as notebooklm,
        ROUND(SUM(CASE WHEN app_capcut THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as capcut,
        ROUND(SUM(CASE WHEN app_gamma THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as gamma,
        ROUND(SUM(CASE WHEN app_clipsai THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as clipsai,
        ROUND(SUM(CASE WHEN app_chrome THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as chrome,
        SUM(CASE WHEN app_claude THEN 1 ELSE 0 END) as claude_n,
        SUM(CASE WHEN app_notebooklm THEN 1 ELSE 0 END) as notebooklm_n,
        SUM(CASE WHEN app_capcut THEN 1 ELSE 0 END) as capcut_n,
        SUM(CASE WHEN app_gamma THEN 1 ELSE 0 END) as gamma_n,
        SUM(CASE WHEN app_clipsai THEN 1 ELSE 0 END) as clipsai_n,
        SUM(CASE WHEN app_chrome THEN 1 ELSE 0 END) as chrome_n
      FROM submissions
    `);

    // [FIX #7] 도구 통계: task_name이 있는 행만 집계 (NULL tool 제외)
    const tools = await pool.query(`
      SELECT tool, COUNT(*) as cnt FROM (
        SELECT task1_tool as tool FROM submissions
          WHERE task1_name IS NOT NULL AND task1_name != '' AND task1_tool IS NOT NULL
        UNION ALL
        SELECT task2_tool FROM submissions
          WHERE task2_name IS NOT NULL AND task2_name != '' AND task2_tool IS NOT NULL
        UNION ALL
        SELECT task3_tool FROM submissions
          WHERE task3_name IS NOT NULL AND task3_name != '' AND task3_tool IS NOT NULL
      ) t GROUP BY tool ORDER BY cnt DESC
    `);

    // CapCut 결과물 분포
    const ccOutput = await pool.query(`
      SELECT material_cc_output as output, COUNT(*) as cnt
      FROM submissions
      WHERE material_cc_output IS NOT NULL AND material_cc_output != ''
      GROUP BY material_cc_output ORDER BY cnt DESC
    `);

    // 체크리스트 현황
    const chk = await pool.query(`
      SELECT
        ROUND(SUM(CASE WHEN check_laptop THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as laptop,
        ROUND(SUM(CASE WHEN check_chrome THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as chrome,
        ROUND(SUM(CASE WHEN check_login THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as login,
        ROUND(SUM(CASE WHEN check_video THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as video,
        ROUND(SUM(CASE WHEN check_pdf THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as pdf,
        ROUND(SUM(CASE WHEN check_worksheet THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as worksheet,
        ROUND(SUM(CASE WHEN check_tasks THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as tasks
      FROM submissions
    `);

    // 시간별 제출 현황
    const timeline = await pool.query(`
      SELECT DATE(submitted_at AT TIME ZONE 'Asia/Seoul') as date, COUNT(*) as cnt
      FROM submissions
      GROUP BY date ORDER BY date
    `);

    // 최근 제출 (10건)
    const recent = await pool.query(`
      SELECT id, name, email,
        app_claude, app_notebooklm, app_capcut,
        check_laptop, check_chrome, check_login,
        personal_goal,
        submitted_at AT TIME ZONE 'Asia/Seoul' as submitted_kst
      FROM submissions ORDER BY submitted_at DESC LIMIT 10
    `);

    // [FIX #3] 목표 선언: recent에서 뽑지 않고 별도 쿼리 — 전원 목표 반환
    const goals = await pool.query(`
      SELECT id, name, personal_goal
      FROM submissions
      WHERE personal_goal IS NOT NULL AND personal_goal != ''
      ORDER BY submitted_at DESC
    `);

    // 자동화 업무명 목록 (강사 참고용)
    const taskNames = await pool.query(`
      SELECT task_name, COUNT(*) as cnt FROM (
        SELECT task1_name as task_name FROM submissions WHERE task1_name IS NOT NULL AND task1_name != ''
        UNION ALL
        SELECT task2_name FROM submissions WHERE task2_name IS NOT NULL AND task2_name != ''
        UNION ALL
        SELECT task3_name FROM submissions WHERE task3_name IS NOT NULL AND task3_name != ''
      ) t GROUP BY task_name ORDER BY cnt DESC LIMIT 20
    `);

    res.json({
      total: totalCount,
      apps: apps.rows[0],
      tools: tools.rows,
      ccOutput: ccOutput.rows,
      checklist: chk.rows[0],
      timeline: timeline.rows,
      recent: recent.rows,
      goals: goals.rows,        // [FIX #3] 전체 목표 별도 반환
      taskNames: taskNames.rows // 신규: 업무명 집계
    });
  } catch (err) {
    console.error('통계 오류:', err);
    res.status(500).json({ error: '통계 조회 실패' });
  }
});

// ── API: 전체 응답 (CSV 다운로드) ────────────────────────────
app.get('/api/responses', async (req, res) => {
  try {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: '접근 권한 없음' });
    }

    const result = await pool.query('SELECT * FROM submissions ORDER BY submitted_at DESC');

    // [FIX #5] 빈 테이블 엣지케이스 처리
    if (result.rows.length === 0) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="responses.csv"');
      return res.send('\uFEFF데이터 없음\n');
    }

    const headers = Object.keys(result.rows[0]).join(',');
    const rows = result.rows.map(r =>
      Object.values(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = '\uFEFF' + headers + '\n' + rows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="responses.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: '조회 실패' });
  }
});

// ── 관리자 대시보드 ───────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ── 헬스체크 ─────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/', (req, res) => res.json({ service: 'RPA0425 Workshop API', status: 'running' }));

// ── 서버 시작 ─────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 서버 실행 중: http://localhost:${PORT}`);
    console.log(`📊 관리자 대시보드: http://localhost:${PORT}/admin`);
  });
}).catch(err => {
  console.error('DB 초기화 실패:', err);
  process.exit(1);
});
