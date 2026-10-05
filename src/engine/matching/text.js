// Maintained source: explicit dependencies; no ordered concatenation.


export function isAdministrativeTitle_(title) {
  var value = String(title || "").trim().toLowerCase();
  var contains = ['archive', 'overview', 'start here', 'syllabus', 'instructor'];
  var exact = ['resource', 'resources', 'student resource', 'student resources', 'instructor resource', 'instructor resources', 'interactive', 'indirect'];
  if (exact.indexOf(value) > -1) return true;
  return contains.some(function(term) { return value.indexOf(term) > -1; });
}

export function countCoreEmptyFolders_(nodes, insideAdministrativeBranch) {
  if (!Array.isArray(nodes)) return 0;
  var total = 0;
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i] || {};
    var ignored = insideAdministrativeBranch || isAdministrativeTitle_(node.title);
    if (!ignored && node.autoDeleted) total++;
    total += countCoreEmptyFolders_(node.children || [], ignored);
  }
  return total;
}

export function predictLaborHours(ifs, totalItems, ltiCount, emptyFolders) {
  var inputs = [Number(ifs)||0, Number(totalItems)||0, Number(ltiCount)||0, Number(emptyFolders)||0];
  var weights = [ [0.05, 0.02, 1.5, 0.8], [0.01, 0.05, 0.2, 0.1] ];
  var bias = [0.5, 0.1];
  var hidden = weights.map(function(w, i) {
    var sum = w.reduce(function(acc, val, j) { return acc + val * inputs[j]; }, 0) + bias[i];
    return Math.max(0, sum);
  });
  var predictedHours = (hidden[0] * 0.85) + (hidden[1] * 0.3) + 1.2;
  return Math.max(1, Math.round(predictedHours));
}

export function calculateCosineSimilarity(vecA, vecB) {
  var dotProduct = 0, normA = 0, normB = 0;
  for (var i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]; normA += Math.pow(vecA[i], 2); normB += Math.pow(vecB[i], 2);
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function vectorizeCourse(pkg) {
  pkg = pkg || {};
  function lg(v){ return Math.log1p(Math.max(0, Number(v)||0)); }
  var assessments = Number(pkg.quizzes || pkg.assessments || 0);
  var total = Number(pkg.totalItems || 0) || ((Number(pkg.webcontent)||0)+assessments+(Number(pkg.discussions)||0)+(Number(pkg.weblinks)||0)+(Number(pkg.lti)||0)+(Number(pkg.unknown)||0));
  return [
    lg(pkg.webcontent), lg(assessments), lg(pkg.discussions), lg(pkg.weblinks), lg(pkg.lti),
    lg(pkg.empty), lg(pkg.unknown), lg(pkg.orphans), lg(pkg.interactiveRuntimeCandidates), lg(total)
  ];
}

export const CTI_GATEWAY_RELEASE_ = 'v8.0.0';

export const CTI_QA_ENGINE_BUILD_ID_ = 'v8.0.1-source-wording-readiness-20261005';

export function qaCleanText_(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

export function qaCleanName_(value) {
    return qaCleanText_(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
}

export function qaMatchTitleKey_(value) {
    // Preserve explicit failure sentinels for reporting, but remove the known
    // Coursera wrapper when reserving the destination for the corresponding
    // source title. This prevents an error-prefixed item from losing its exact
    // source identity during global matching.
    var raw = qaCleanText_(value || '').replace(/^\[ERROR DURING DISTILLATION\]\s*/i, '');
    return qaCleanName_(raw);
}

export function qaPathParts_(path) {
    return qaCleanText_(path)
      .split('>')
      .map(function(part) { return part.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); })
      .filter(function(part) { return part && part !== 'root'; });
}

export function qaTokenSet_(value) {
    var tokens = qaCleanText_(value).toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
    var stop = { the:1, a:1, an:1, and:1, or:1, of:1, to:1, in:1, on:1, for:1, with:1, is:1, are:1, be:1, by:1, from:1 };
    var set = Object.create(null);
    tokens.forEach(function(token) { if (!stop[token]) set[token] = true; });
    return set;
}

export function qaJaccard_(left, right) {
    var a = qaTokenSet_(left), b = qaTokenSet_(right);
    var aKeys = Object.keys(a), bKeys = Object.keys(b);
    if (!aKeys.length || !bKeys.length) return 0;
    var intersection = 0;
    aKeys.forEach(function(key) { if (b[key]) intersection++; });
    var union = aKeys.length + bKeys.length - intersection;
    return union ? intersection / union : 0;
}

export function levenshtein_(a, b) {
    a = String(a || '');
    b = String(b || '');
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    var matrix = [];
    var i, j;
    for (i = 0; i <= b.length; i++) matrix[i] = [i];
    for (j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (i = 1; i <= b.length; i++) {
        for (j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

export function fuzzyMatchScore_(left, right) {
    var a = String(left || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    var b = String(right || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (a === b) return 1;
    if (!a || !b) return 0;
    if (a.indexOf(b) > -1 || b.indexOf(a) > -1) return 0.9;

    var distance = levenshtein_(a, b);
    var maxLen = Math.max(a.length, b.length);
    return maxLen ? 1 - (distance / maxLen) : 1;
}

export function qaPathSimilarity_(left, right) {
    var a = qaPathParts_(left), b = qaPathParts_(right);
    if (!a.length || !b.length) return null;
    var aText = a.join(' '), bText = b.join(' ');
    if (aText === bText) return 1;
    var tokenScore = qaJaccard_(aText, bText);
    var tailScore = a[a.length - 1] === b[b.length - 1] ? 1 : fuzzyMatchScore_(a[a.length - 1], b[b.length - 1]);
    return Math.max(tokenScore, (tokenScore * 0.65) + (tailScore * 0.35));
}

export function normalizeCourseraType_(typeName) {
    var t = String(typeName || '').trim().toLowerCase();
    if (!t) return 'Reading';
    if (t === 'supplement' || t === 'reading' || t.indexOf('lecture') > -1) return 'Reading';
    if (t === 'staffgraded' || t === 'ungradedassignment' || t.indexOf('assignment') > -1 || t.indexOf('peer') > -1) return 'Assignment';
    if (t === 'discussionprompt' || t.indexOf('discussion') > -1) return 'Discussion';
    if (t === 'ungradedwidget' || t === 'plugin' || t === 'lti' || t.indexOf('widget') > -1) return 'Plugin';
    if (t === 'exam' || t === 'quiz' || t.indexOf('quiz') > -1 || t.indexOf('exam') > -1) return 'Assessment';
    if (t.indexOf('video') > -1) return 'Video';
    return qaCleanText_(typeName) || 'Reading';
}
