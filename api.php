<?php
// Campus TgMaster — API JSON (étudiants et administrateur).
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

try {
    start_session();
    $action = (string)($_GET['action'] ?? '');
    $handler = 'act_' . preg_replace('/[^a-z_]/', '', $action);
    if ($action === '' || !function_exists($handler)) fail('Action inconnue.', 404);
    $handler();
} catch (Throwable $e) {
    error_log('[campus] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    fail('Erreur du serveur. Réessayez dans un instant.', 500);
}

/* ------------------------------------------------------------------ */
/* Étudiant                                                            */
/* ------------------------------------------------------------------ */

function student_payload(array $s): array {
    $outline = [];
    foreach (courses() as $c) {
        $lessons = [];
        foreach ($c['lessons'] as $l) {
            $lessons[] = ['id' => $l['id'], 'n' => $l['n'], 't' => $l['t'], 'min' => $l['min'], 'nq' => count($l['quiz'])];
        }
        $outline[] = ['id' => $c['id'], 'code' => $c['code'], 'unit' => $c['unit'], 'title' => $c['title'], 'summary' => $c['summary'], 'lessons' => $lessons];
    }
    $st = db()->prepare('SELECT lesson_id, score, good, total, submitted_at FROM results WHERE student_id = ?');
    $st->execute([$s['id']]);
    $results = [];
    foreach ($st as $r) {
        $results[$r['lesson_id']] = ['score' => (int)$r['score'], 'good' => (int)$r['good'], 'total' => (int)$r['total'], 'at' => (int)$r['submitted_at']];
    }
    return [
        'student' => ['matricule' => $s['matricule'], 'nom' => $s['nom'], 'prenoms' => $s['prenoms'], 'classe' => $s['classe']],
        'courses' => $outline,
        'results' => $results,
        'pass' => PASS_MARK,
        'csrf' => $_SESSION['csrf'],
    ];
}

function act_login(): void {
    require_post();
    $b = body();
    $mat = norm_matricule((string)($b['matricule'] ?? ''));
    $pw = (string)($b['password'] ?? '');
    $key = 's:' . $mat . ':' . client_ip();
    throttle_check($key);
    $st = db()->prepare('SELECT * FROM students WHERE matricule = ?');
    $st->execute([$mat]);
    $s = $st->fetch();
    if (!$s || !password_verify($pw, $s['pass_hash'])) {
        throttle_hit($key);
        fail('Identifiant ou mot de passe incorrect.', 401);
    }
    if (!(int)$s['active']) fail("Ce compte est désactivé. Contactez l'administration.", 403);
    throttle_clear($key);
    session_regenerate_id(true);
    unset($_SESSION['aid']);
    $_SESSION['sid'] = (int)$s['id'];
    $_SESSION['csrf'] = bin2hex(random_bytes(24));
    db()->prepare('UPDATE students SET last_login = ? WHERE id = ?')->execute([time(), $s['id']]);
    json_out(student_payload($s));
}

function act_logout(): void {
    require_post();
    $_SESSION = [];
    session_destroy();
    json_out(['ok' => true]);
}

function act_state(): void {
    json_out(student_payload(require_student()));
}

/** Contenu d'une leçon. Les bonnes réponses ne sont envoyées qu'après la validation du quiz. */
function act_lesson(): void {
    $s = require_student();
    $found = find_lesson((string)($_GET['id'] ?? ''));
    if (!$found) fail('Leçon introuvable.', 404);
    [, $l] = $found;
    $st = db()->prepare('SELECT score, good, total, answers, submitted_at FROM results WHERE student_id = ? AND lesson_id = ?');
    $st->execute([$s['id'], $l['id']]);
    $r = $st->fetch();
    $show = $r && setting('show_corrections', '1') === '1';
    $chosen = $r ? json_decode($r['answers'], true) : [];
    $quiz = [];
    foreach ($l['quiz'] as $i => $q) {
        $item = ['q' => $q['q'], 'o' => $q['o']];
        if ($r) $item['chosen'] = $chosen[$i] ?? null;
        if ($show) { $item['a'] = $q['a']; $item['e'] = $q['e']; }
        $quiz[] = $item;
    }
    $nt = db()->prepare('SELECT body FROM notes WHERE student_id = ? AND lesson_id = ?');
    $nt->execute([$s['id'], $l['id']]);
    json_out([
        'id' => $l['id'], 'html' => $l['html'], 'quiz' => $quiz,
        'result' => $r ? ['score' => (int)$r['score'], 'good' => (int)$r['good'], 'total' => (int)$r['total'], 'at' => (int)$r['submitted_at']] : null,
        'corrections' => $show,
        'note' => (string)($nt->fetchColumn() ?: ''),
    ]);
}

/** Validation unique d'un quiz : corrigé côté serveur, une seule ligne possible par étudiant et par leçon. */
function act_submit(): void {
    require_post();
    $s = require_student();
    require_csrf();
    $b = body();
    $found = find_lesson((string)($b['lesson'] ?? ''));
    if (!$found) fail('Leçon introuvable.', 404);
    [$c, $l] = $found;
    $answers = $b['answers'] ?? null;
    $n = count($l['quiz']);
    if (!is_array($answers) || count($answers) !== $n) fail('Réponses incomplètes.', 400);
    $good = 0;
    $clean = [];
    foreach ($l['quiz'] as $i => $q) {
        $a = $answers[$i] ?? null;
        if (!is_int($a) || $a < 0 || $a >= count($q['o'])) fail('Répondez à toutes les questions avant de valider.', 400);
        $clean[] = $a;
        if ($a === $q['a']) $good++;
    }
    $score = (int)round($good / $n * 100);
    try {
        db()->prepare('INSERT INTO results (student_id, lesson_id, course_id, score, good, total, answers, submitted_at) VALUES (?,?,?,?,?,?,?,?)')
            ->execute([$s['id'], $l['id'], $c['id'], $score, $good, $n, json_encode($clean), time()]);
    } catch (PDOException $e) {
        if (stripos($e->getMessage(), 'UNIQUE') !== false) fail('Ce quiz a déjà été validé. Une seule validation est autorisée.', 409);
        throw $e;
    }
    $_GET['id'] = $l['id'];
    act_lesson();
}

function act_note(): void {
    require_post();
    $s = require_student();
    require_csrf();
    $b = body();
    $found = find_lesson((string)($b['lesson'] ?? ''));
    if (!$found) fail('Leçon introuvable.', 404);
    $text = (string)($b['body'] ?? '');
    if (strlen($text) > 20000) fail('Note trop longue.', 400);
    db()->prepare('INSERT OR REPLACE INTO notes (student_id, lesson_id, body, updated_at) VALUES (?,?,?,?)')
        ->execute([$s['id'], $found[1]['id'], $text, time()]);
    json_out(['ok' => true]);
}

function act_password(): void {
    require_post();
    $s = require_student();
    require_csrf();
    $b = body();
    $new = (string)($b['new'] ?? '');
    if (strlen($new) < 8) fail('Le nouveau mot de passe doit contenir au moins 8 caractères.', 400);
    $st = db()->prepare('SELECT pass_hash FROM students WHERE id = ?');
    $st->execute([$s['id']]);
    if (!password_verify((string)($b['old'] ?? ''), (string)$st->fetchColumn())) fail('Mot de passe actuel incorrect.', 400);
    db()->prepare('UPDATE students SET pass_hash = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $s['id']]);
    json_out(['ok' => true]);
}

/* ------------------------------------------------------------------ */
/* Administrateur                                                      */
/* ------------------------------------------------------------------ */

function admin_exists(): bool {
    return (int)db()->query('SELECT COUNT(*) FROM admins')->fetchColumn() > 0;
}

function act_admin_status(): void {
    json_out(['setup' => !admin_exists(), 'logged' => !empty($_SESSION['aid']), 'csrf' => $_SESSION['csrf']]);
}

/** Création du premier compte administrateur, possible une seule fois. */
function act_admin_setup(): void {
    require_post();
    $b = body();
    if (admin_exists()) fail('Un administrateur existe déjà.', 409);
    $u = clean((string)($b['username'] ?? ''), 60);
    $p = (string)($b['password'] ?? '');
    if (strlen($u) < 3) fail("L'identifiant doit contenir au moins 3 caractères.", 400);
    if (strlen($p) < 10) fail('Le mot de passe administrateur doit contenir au moins 10 caractères.', 400);
    db()->prepare('INSERT INTO admins (username, pass_hash, created_at) VALUES (?,?,?)')->execute([$u, password_hash($p, PASSWORD_DEFAULT), time()]);
    session_regenerate_id(true);
    unset($_SESSION['sid']);
    $_SESSION['aid'] = (int)db()->lastInsertId();
    $_SESSION['csrf'] = bin2hex(random_bytes(24));
    json_out(['ok' => true, 'csrf' => $_SESSION['csrf']]);
}

function act_admin_login(): void {
    require_post();
    $b = body();
    $u = clean((string)($b['username'] ?? ''), 60);
    $key = 'a:' . strtolower($u) . ':' . client_ip();
    throttle_check($key);
    $st = db()->prepare('SELECT * FROM admins WHERE username = ? COLLATE NOCASE');
    $st->execute([$u]);
    $a = $st->fetch();
    if (!$a || !password_verify((string)($b['password'] ?? ''), $a['pass_hash'])) {
        throttle_hit($key);
        fail('Identifiant ou mot de passe incorrect.', 401);
    }
    throttle_clear($key);
    session_regenerate_id(true);
    unset($_SESSION['sid']);
    $_SESSION['aid'] = (int)$a['id'];
    $_SESSION['csrf'] = bin2hex(random_bytes(24));
    json_out(['ok' => true, 'csrf' => $_SESSION['csrf']]);
}

function act_admin_state(): void {
    require_admin();
    $outline = [];
    $total = 0;
    foreach (courses() as $c) {
        $ls = [];
        foreach ($c['lessons'] as $l) { $ls[] = ['id' => $l['id'], 'n' => $l['n'], 't' => $l['t']]; $total++; }
        $outline[] = ['id' => $c['id'], 'code' => $c['code'], 'title' => $c['title'], 'lessons' => $ls];
    }
    $students = db()->query('
        SELECT s.id, s.matricule, s.nom, s.prenoms, s.classe, s.active, s.created_at, s.last_login,
               COUNT(r.id) AS done, COALESCE(SUM(r.score >= ' . PASS_MARK . '), 0) AS passed,
               AVG(r.score) AS avg, MAX(r.submitted_at) AS last_result
        FROM students s LEFT JOIN results r ON r.student_id = s.id
        GROUP BY s.id ORDER BY s.nom COLLATE NOCASE, s.prenoms COLLATE NOCASE')->fetchAll();
    foreach ($students as &$s) {
        foreach (['id', 'active', 'created_at', 'done', 'passed'] as $k) $s[$k] = (int)$s[$k];
        $s['avg'] = $s['avg'] === null ? null : (int)round((float)$s['avg']);
        $s['last_login'] = $s['last_login'] === null ? null : (int)$s['last_login'];
        $s['last_result'] = $s['last_result'] === null ? null : (int)$s['last_result'];
    }
    unset($s);
    $results = db()->query('
        SELECT r.id, r.student_id, r.lesson_id, r.course_id, r.score, r.good, r.total, r.submitted_at
        FROM results r ORDER BY r.submitted_at DESC, r.id DESC LIMIT 5000')->fetchAll();
    foreach ($results as &$r) {
        foreach (['id', 'student_id', 'score', 'good', 'total', 'submitted_at'] as $k) $r[$k] = (int)$r[$k];
    }
    unset($r);
    json_out([
        'courses' => $outline, 'lessons_total' => $total, 'students' => $students, 'results' => $results,
        'pass' => PASS_MARK, 'show_corrections' => setting('show_corrections', '1') === '1', 'csrf' => $_SESSION['csrf'],
    ]);
}

function insert_student(string $mat, string $nom, string $prenoms, string $classe): array {
    $pw = make_password();
    db()->prepare('INSERT INTO students (matricule, nom, prenoms, classe, pass_hash, created_at) VALUES (?,?,?,?,?,?)')
        ->execute([$mat, $nom, $prenoms, $classe, password_hash($pw, PASSWORD_DEFAULT), time()]);
    return ['matricule' => $mat, 'nom' => $nom, 'prenoms' => $prenoms, 'classe' => $classe, 'password' => $pw];
}

function matricule_taken(string $mat): bool {
    $st = db()->prepare('SELECT 1 FROM students WHERE matricule = ?');
    $st->execute([$mat]);
    return (bool)$st->fetchColumn();
}

function act_student_create(): void {
    require_post(); require_admin(); require_csrf();
    $b = body();
    $mat = norm_matricule((string)($b['matricule'] ?? ''));
    $nom = clean((string)($b['nom'] ?? ''), 80);
    if ($mat === '') fail('Matricule invalide : 2 à 40 caractères, lettres, chiffres, point, tiret ou barre oblique.', 400);
    if ($nom === '') fail('Le nom est obligatoire.', 400);
    if (matricule_taken($mat)) fail('Ce matricule existe déjà.', 409);
    json_out(['created' => [insert_student($mat, $nom, clean((string)($b['prenoms'] ?? ''), 120), clean((string)($b['classe'] ?? ''), 60))]]);
}

/** Création en lot : une ligne par étudiant, « matricule;nom;prénoms;classe » (séparateur ; , ou tabulation). */
function act_students_import(): void {
    require_post(); require_admin(); require_csrf();
    $b = body();
    $lines = preg_split('/\r\n|\r|\n/', (string)($b['text'] ?? '')) ?: [];
    if (count($lines) > 2000) fail('2 000 lignes au maximum par import.', 400);
    $created = []; $errors = []; $seen = [];
    $pdo = db();
    $pdo->beginTransaction();
    foreach ($lines as $i => $line) {
        if (trim($line) === '') continue;
        $sep = strpos($line, "\t") !== false ? "\t" : (strpos($line, ';') !== false ? ';' : ',');
        $p = array_map('trim', explode($sep, $line));
        $mat = norm_matricule($p[0] ?? '');
        $nom = clean($p[1] ?? '', 80);
        if ($i === 0 && stripos($p[0] ?? '', 'matricule') !== false) continue; // ligne d'en-tête
        if ($mat === '' || $nom === '') { $errors[] = 'Ligne ' . ($i + 1) . ' : matricule ou nom manquant ou invalide.'; continue; }
        if (isset($seen[$mat]) || matricule_taken($mat)) { $errors[] = 'Ligne ' . ($i + 1) . ' : le matricule ' . $mat . ' existe déjà.'; continue; }
        $seen[$mat] = true;
        $created[] = insert_student($mat, $nom, clean($p[2] ?? '', 120), clean($p[3] ?? ($b['classe'] ?? ''), 60));
    }
    $pdo->commit();
    json_out(['created' => $created, 'errors' => $errors]);
}

function act_student_update(): void {
    require_post(); require_admin(); require_csrf();
    $b = body();
    $id = (int)($b['id'] ?? 0);
    $st = db()->prepare('SELECT * FROM students WHERE id = ?');
    $st->execute([$id]);
    $s = $st->fetch();
    if (!$s) fail('Étudiant introuvable.', 404);
    $out = ['ok' => true];
    if (array_key_exists('active', $b)) {
        db()->prepare('UPDATE students SET active = ? WHERE id = ?')->execute([$b['active'] ? 1 : 0, $id]);
    }
    if (isset($b['nom']) || isset($b['prenoms']) || isset($b['classe'])) {
        $nom = clean((string)($b['nom'] ?? $s['nom']), 80);
        if ($nom === '') fail('Le nom est obligatoire.', 400);
        db()->prepare('UPDATE students SET nom = ?, prenoms = ?, classe = ? WHERE id = ?')
            ->execute([$nom, clean((string)($b['prenoms'] ?? $s['prenoms']), 120), clean((string)($b['classe'] ?? $s['classe']), 60), $id]);
    }
    if (!empty($b['reset_password'])) {
        $pw = make_password();
        db()->prepare('UPDATE students SET pass_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $id]);
        $out['password'] = $pw;
        $out['matricule'] = $s['matricule'];
    }
    json_out($out);
}

function act_student_delete(): void {
    require_post(); require_admin(); require_csrf();
    $id = (int)(body()['id'] ?? 0);
    db()->prepare('DELETE FROM students WHERE id = ?')->execute([$id]);
    json_out(['ok' => true]);
}

/** Autorise une nouvelle tentative en supprimant le résultat enregistré. */
function act_result_reset(): void {
    require_post(); require_admin(); require_csrf();
    $b = body();
    db()->prepare('DELETE FROM results WHERE student_id = ? AND lesson_id = ?')->execute([(int)($b['student_id'] ?? 0), (string)($b['lesson_id'] ?? '')]);
    json_out(['ok' => true]);
}

function act_admin_settings(): void {
    require_post(); $aid = require_admin(); require_csrf();
    $b = body();
    if (array_key_exists('show_corrections', $b)) set_setting('show_corrections', $b['show_corrections'] ? '1' : '0');
    if (isset($b['new_password'])) {
        $new = (string)$b['new_password'];
        if (strlen($new) < 10) fail('Le mot de passe administrateur doit contenir au moins 10 caractères.', 400);
        $st = db()->prepare('SELECT pass_hash FROM admins WHERE id = ?');
        $st->execute([$aid]);
        if (!password_verify((string)($b['old_password'] ?? ''), (string)$st->fetchColumn())) fail('Mot de passe actuel incorrect.', 400);
        db()->prepare('UPDATE admins SET pass_hash = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $aid]);
    }
    json_out(['ok' => true]);
}

/** Export CSV de tous les résultats (ouvrable dans Excel). */
function act_export(): void {
    require_admin();
    $titles = [];
    foreach (courses() as $c) foreach ($c['lessons'] as $l) $titles[$l['id']] = [$c['code'], $c['title'], $l['n'], $l['t']];
    $rows = db()->query('
        SELECT s.matricule, s.nom, s.prenoms, s.classe, r.lesson_id, r.score, r.good, r.total, r.submitted_at
        FROM results r JOIN students s ON s.id = r.student_id
        ORDER BY s.nom COLLATE NOCASE, s.prenoms COLLATE NOCASE, r.lesson_id');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="resultats-campus-tgmaster-' . date('Y-m-d') . '.csv"');
    header('Cache-Control: no-store');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    $put = function (array $cells) use ($out) {
        // neutralise les formules (=, +, -, @) qu'un tableur pourrait exécuter
        foreach ($cells as &$v) { $v = (string)$v; if ($v !== '' && strpbrk($v[0], "=+-@\t\r") !== false) $v = "'" . $v; }
        fputcsv($out, $cells, ';', '"', '\\');
    };
    $put(['Matricule', 'Nom', 'Prénoms', 'Classe', 'Code cours', 'Cours', 'Leçon n°', 'Leçon', 'Score (%)', 'Bonnes réponses', 'Questions', 'Validée', 'Date']);
    foreach ($rows as $r) {
        $t = $titles[$r['lesson_id']] ?? ['', '', '', $r['lesson_id']];
        $put([$r['matricule'], $r['nom'], $r['prenoms'], $r['classe'], $t[0], $t[1], $t[2], $t[3], $r['score'], $r['good'], $r['total'],
            (int)$r['score'] >= PASS_MARK ? 'Oui' : 'Non', date('d/m/Y H:i', (int)$r['submitted_at'])]);
    }
    exit;
}
