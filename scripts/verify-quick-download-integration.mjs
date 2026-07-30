import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function check(label, condition) {
  if (!condition) {
    throw new Error(`FAIL: ${label}`);
  }

  console.log(`PASS: ${label}`);
}

const panel = read('src/renderer/src/components/QuickDownloadPanel.tsx');
const quickTest = read('tests/unit/quick-download.test.ts');
const durationTest = read('tests/unit/video-duration-input.test.ts');
const css = read('src/renderer/src/quick-download.css');

check('Quick Download panel exists', panel.includes('QuickDownloadPanel'));

check('range fields do not use clock-time inputs', !panel.includes('type="time"'));

check(
  'start and end fields are video duration offsets',
  panel.includes('Mốc thời lượng bắt đầu') && panel.includes('Mốc thời lượng kết thúc')
);

check(
  'duration fields accept HH:MM:SS characters',
  panel.includes('pattern="[0-9:]*"') && panel.includes('placeholder="00:10:00"')
);

check(
  'duration fields do not render browser AM/PM controls',
  panel.includes('className="video-duration-input"') &&
    !panel.includes('step={1}') &&
    !panel.includes('min="00:00:00"')
);

check(
  'start and end state remain connected',
  panel.includes('value={startTime}') &&
    panel.includes('setStartTime') &&
    panel.includes('value={endTime}') &&
    panel.includes('setEndTime')
);

check(
  'duration defaults remain ten and thirteen minutes',
  panel.includes("'00:10:00'") && panel.includes("'00:13:00'")
);

check('duration sanitizer only keeps digits and colons', panel.includes("replace(/[^0-9:]/g, '')"));

check('duration input styling exists', css.includes('.video-duration-input'));

check(
  'Quick Download behavior tests remain present',
  quickTest.includes('Quick Download') ||
    quickTest.includes('quick download') ||
    quickTest.includes('thời gian') ||
    quickTest.includes('timestamp')
);

check(
  'dedicated duration input tests exist',
  durationTest.includes('HH:MM:SS') && durationTest.includes('type="time"')
);

console.log('Quick Download duration verification OK: 11 checks.');
