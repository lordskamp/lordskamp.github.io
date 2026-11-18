import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchAttachmentStyles, scoreAttachment, statements } from '../attachment/assessment.js';

test('ECR-RS reverses only the first four items and averages the two scales independently', () => {
    assert.equal(statements.length, 9);
    assert.deepEqual(scoreAttachment([7, 6, 5, 4, 2, 3, 2, 4, 7]), {
        anxiety: 13 / 3,
        avoidance: 15 / 6
    });
    assert.deepEqual(scoreAttachment([7, 7, 7, 7, 1, 1, 1, 1, 1]), { anxiety: 1, avoidance: 1 });
    assert.deepEqual(scoreAttachment([1, 1, 1, 1, 7, 7, 7, 7, 7]), { anxiety: 7, avoidance: 7 });
});

test('incomplete or out-of-range responses cannot be scored', () => {
    assert.throws(() => scoreAttachment(Array(8).fill(4)), RangeError);
    assert.throws(() => scoreAttachment(Array(9)), RangeError);
    assert.throws(() => scoreAttachment([0, 8, 1, 1, 1, 1, 1, 1, 1]), RangeError);
});

test('the four prototypes follow the two independent scores', () => {
    assert.deepEqual(matchAttachmentStyles({ anxiety: 2, avoidance: 2 }), ['secure']);
    assert.deepEqual(matchAttachmentStyles({ anxiety: 6, avoidance: 2 }), ['anxious']);
    assert.deepEqual(matchAttachmentStyles({ anxiety: 2, avoidance: 6 }), ['dismissive']);
    assert.deepEqual(matchAttachmentStyles({ anxiety: 6, avoidance: 6 }), ['fearful']);
});

test('scores within the display band allow the adjacent styles', () => {
    assert.deepEqual(matchAttachmentStyles({ anxiety: 4, avoidance: 2 }), ['secure', 'anxious']);
    assert.deepEqual(matchAttachmentStyles({ anxiety: 6, avoidance: 3.5 }), ['anxious', 'fearful']);
    assert.deepEqual(matchAttachmentStyles({ anxiety: 2, avoidance: 4.5 }), ['secure', 'dismissive']);
    assert.equal(matchAttachmentStyles(scoreAttachment(Array(9).fill(4))).length, 4);
});
