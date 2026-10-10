"""Download benchmark TF.js weights and tokenizer files (also works on Windows)."""
import argparse
import json
import shutil
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

DEST = Path(__file__).resolve().parents[1] / 'frontend/public/models'
STORAGE = 'https://storage.googleapis.com/tfjs-models/savedmodel/'
MODELS = {
    'model-a': ('https://tfhub.dev/google/imagenet/mobilenet_v2_100_224/classification/2/model.json?tfjs-format=file', {}),
    'model-b': (STORAGE + 'universal_sentence_encoder/model.json', {
        'vocab.json': STORAGE + 'universal_sentence_encoder/vocab.json'}),
    'toxicity': (STORAGE + 'toxicity/model.json', {}),
    'qna': ('https://tfhub.dev/tensorflow/tfjs-model/mobilebert/1/model.json?tfjs-format=file', {
        'processed_vocab.json': 'https://tfhub.dev/tensorflow/tfjs-model/mobilebert/1/processed_vocab.json?tfjs-format=file'}),
    'coco-ssd': (STORAGE + 'ssd_mobilenet_v2/model.json', {}),
    'face-detector': ('https://tfhub.dev/mediapipe/tfjs-model/face_detection/short/1/model.json?tfjs-format=file', {}),
}


def download(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.part')
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'model-benchmark/1.0'}), timeout=120) as response:
                resolved = response.url
                with temporary.open('wb') as output:
                    shutil.copyfileobj(response, output)
            temporary.replace(target)
            return resolved
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def fetch_model(name):
    url, extras = MODELS[name]
    folder = DEST / name
    print(f'==> {name}: model.json', flush=True)
    resolved = download(url, folder / 'model.json')
    manifest = json.loads((folder / 'model.json').read_text(encoding='utf-8'))
    if not manifest.get('modelTopology') or not manifest.get('weightsManifest'):
        raise ValueError(f'{name}: invalid TF.js manifest')
    for group in manifest['weightsManifest']:
        for shard in group['paths']:
            path = Path(shard)
            if path.is_absolute() or '..' in path.parts or urlparse(shard).scheme:
                raise ValueError(f'{name}: unsafe shard path {shard}')
            target = folder / path
            if target.exists() and target.stat().st_size:
                continue
            print(f'    {shard}', flush=True)
            # Signed Kaggle redirects authorize only the requested file, not siblings.
            shard_url = urljoin(url if urlparse(url).hostname == 'tfhub.dev' else resolved, shard)
            if urlparse(url).hostname == 'tfhub.dev':
                shard_url += '?tfjs-format=file'
            download(shard_url, target)
    for filename, extra_url in extras.items():
        print(f'    {filename}', flush=True)
        download(extra_url, folder / filename)
        json.loads((folder / filename).read_text(encoding='utf-8'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('models', nargs='*')
    args = parser.parse_args()
    for name in args.models or MODELS:
        if name not in MODELS:
            parser.error(f'Unknown model {name}. Choices: {", ".join(MODELS)}')
        fetch_model(name)
    print('Ready. Set VITE_MODEL_SOURCE=local and rebuild the frontend.')
