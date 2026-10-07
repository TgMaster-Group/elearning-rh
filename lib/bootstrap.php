<?php
// Campus TgMaster — socle commun : configuration, base de données, session, utilitaires.
declare(strict_types=1);

const APP_VERSION = '1.0';
const PASS_MARK = 70;                // seuil de validation d'une leçon, en %
const DATA_DIR = __DIR__ . '/../data';

date_default_timezone_set('Africa/Abidjan');
error_reporting(E_ALL);
ini_set('display_errors', '0');

function json_out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $code = 400): void {
    json_out(['error' => $message], $code);
}

/** Configuration locale, créée au premier lancement (nom de base de données aléatoire). */
function cfg(): array {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $file = DATA_DIR . '/config.php';
    if (!is_file($file)) {
        if (!is_dir(DATA_DIR) || !is_writable(DATA_DIR)) {
            fail("Le dossier « data » n'est pas accessible en écriture. Donnez-lui les droits d'écriture (chmod 775) puis rechargez la page.", 500);
        }
        $cfg = ['db' => 'campus-' . bin2hex(random_bytes(8)) . '.sqlite'];
        file_put_contents($file, "<?php\nreturn " . var_export($cfg, true) . ";\n", LOCK_EX);
    } else {
        $cfg = require $file;
    }
    return $cfg;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        fail("L'extension PHP « pdo_sqlite » n'est pas activée sur ce serveur. Activez-la dans la configuration PHP de l'hébergement.", 500);
    }
    $pdo = new PDO('sqlite:' . DATA_DIR . '/' . cfg()['db']);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY, matricule TEXT NOT NULL UNIQUE, nom TEXT NOT NULL, prenoms TEXT NOT NULL DEFAULT '',
            classe TEXT NOT NULL DEFAULT '', pass_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL, last_login INTEGER);
        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            lesson_id TEXT NOT NULL, course_id TEXT NOT NULL, score INTEGER NOT NULL, good INTEGER NOT NULL,
            total INTEGER NOT NULL, answers TEXT NOT NULL, submitted_at INTEGER NOT NULL,
            UNIQUE (student_id, lesson_id));
        CREATE TABLE IF NOT EXISTS notes (
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE, lesson_id TEXT NOT NULL,
            body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (student_id, lesson_id));
        CREATE TABLE IF NOT EXISTS login_attempts (k TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_results_student ON results(student_id);
        CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts(k, at);
    ");
    return $pdo;
}

function setting(string $k, string $default): string {
    $st = db()->prepare('SELECT v FROM settings WHERE k = ?');
    $st->execute([$k]);
    $v = $st->fetchColumn();
    return $v === false ? $default : (string)$v;
}

function set_setting(string $k, string $v): void {
    db()->prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)')->execute([$k, $v]);
}

function courses(): array {
    static $c = null;
    if ($c === null) $c = require DATA_DIR . '/courses.php';
    return $c;
}

/** Retrouve une leçon : [cours, leçon] ou null. */
function find_lesson(string $id): ?array {
    foreach (courses() as $c) {
        foreach ($c['lessons'] as $l) {
            if ($l['id'] === $id) return [$c, $l];
        }
    }
    return null;
}

function start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('CAMPUSSID');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));
}

function body(): array {
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($type, 'application/json') !== 0) fail('Requête invalide.', 415);
    $raw = file_get_contents('php://input');
    if (strlen($raw) > 2 * 1024 * 1024) fail('Requête trop volumineuse.', 413);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function require_post(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('Méthode non autorisée.', 405);
}

function require_csrf(): void {
    $sent = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) fail('Session expirée. Rechargez la page.', 403);
}

function client_ip(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** Limite les essais de connexion : 8 échecs en 15 minutes par identifiant et adresse. */
function throttle_check(string $key): void {
    $since = time() - 900;
    db()->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([$since]);
    $st = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE k = ? AND at >= ?');
    $st->execute([$key, $since]);
    if ((int)$st->fetchColumn() >= 8) fail('Trop de tentatives. Réessayez dans 15 minutes.', 429);
}

function throttle_hit(string $key): void {
    db()->prepare('INSERT INTO login_attempts (k, at) VALUES (?, ?)')->execute([$key, time()]);
}

function throttle_clear(string $key): void {
    db()->prepare('DELETE FROM login_attempts WHERE k = ?')->execute([$key]);
}

function make_password(int $len = 8): string {
    $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // sans caractères ambigus (l, 1, o, 0, i)
    $out = '';
    for ($i = 0; $i < $len; $i++) $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    return $out;
}

function clean(string $s, int $max): string {
    $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
    return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}

function norm_matricule(string $s): string {
    $s = strtoupper(clean($s, 40));
    return preg_match('/^[A-Z0-9][A-Z0-9._\/-]{1,39}$/', $s) ? $s : '';
}

function current_student(): ?array {
    if (empty($_SESSION['sid'])) return null;
    $st = db()->prepare('SELECT id, matricule, nom, prenoms, classe, active FROM students WHERE id = ?');
    $st->execute([(int)$_SESSION['sid']]);
    $s = $st->fetch();
    if (!$s || !(int)$s['active']) { unset($_SESSION['sid']); return null; }
    return $s;
}

function require_student(): array {
    $s = current_student();
    if (!$s) fail('Connexion requise.', 401);
    return $s;
}

function require_admin(): int {
    if (empty($_SESSION['aid'])) fail('Connexion administrateur requise.', 401);
    $st = db()->prepare('SELECT id FROM admins WHERE id = ?');
    $st->execute([(int)$_SESSION['aid']]);
    if (!$st->fetchColumn()) { unset($_SESSION['aid']); fail('Connexion administrateur requise.', 401); }
    return (int)$_SESSION['aid'];
}
