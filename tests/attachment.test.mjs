import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchAttachmentStyles, scoreAttachment, statements } from '../attachment/assessment.js';

test('ECR-R reproduces the author’s worked example', () => {
    assert.equal(statements.length, 36);
    const responses = [
        1, 2, 2, 1, 3, 2, 2, 2, 1, 1, 6, 2, 2, 2, 3, 2, 5, 1,
        2, 5, 2, 5, 2, 4, 2, 6, 6, 7, 7, 5, 6, 2, 6, 6, 6, 6
    ];
    assert.deepEqual(scoreAttachment(responses), {
        anxiety: 42 / 18,
        avoidance: 39 / 18
    });
});

test('each item affects only its published scale, in the published direction', () => {
    const reversed = [9, 11, 20, 22, 26, 27, 28, 29, 30, 31, 33, 34, 35, 36];
    for (let item = 1; item <= 36; item += 1) {
        const responses = Array(36).fill(4);
        responses[item - 1] = 7;
        const affected = (72 + (reversed.includes(item) ? -3 : 3)) / 18;
        assert.deepEqual(scoreAttachment(responses), {
            anxiety: item <= 18 ? affected : 4,
            avoidance: item > 18 ? affected : 4
        }, `item ${item}`);
    }
});

test('incomplete or out-of-range responses cannot be scored', () => {
    assert.throws(() => scoreAttachment(Array(35).fill(4)), RangeError);
    assert.throws(() => scoreAttachment(Array(36)), RangeError);
    assert.throws(() => scoreAttachment([0, ...Array(35).fill(4)]), RangeError);
    assert.throws(() => scoreAttachment([8, ...Array(35).fill(4)]), RangeError);
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
    assert.equal(matchAttachmentStyles(scoreAttachment(Array(36).fill(4))).length, 4);
});
