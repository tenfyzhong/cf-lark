import { expect, it } from 'vitest';
import { localMailImages } from '../src/capabilities/mail/images';
it('rewrites repeated private-artifact image paths and preserves remote/CID references', () => {
    const result = localMailImages(
        '<p><img src="@photo.png"><img src="@photo.png"><img src="https://x.test/a"><img src="cid:existing"></p>',
    );
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
        id: 'photo.png',
        name: 'photo.png',
    });
    expect(result.html.match(/cid:mail-artifact-/g)).toHaveLength(2);
    expect(result.html).toContain('https://x.test/a');
    expect(result.html).toContain('cid:existing');
});
