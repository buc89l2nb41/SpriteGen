# SpriteGen

켜져 있는 SpriteGen을 HTTP로 다룬다. 화면 버튼은 누르지 않는다.

서버 주소는 `http://localhost:5174`이다. `vite.config.ts`의 `strictPort` 때문에 다른 포트는 이 서버가 아니다. 서버를 새로 켜지 않는다. `.env`의 키 값은 읽지도 적지도 않는다. `.gen`은 git에 넣지 않는다.

## 시작

`GET /api/status`에 `boot`, `character`, `fal`이 있어야 한다.

- `character`가 없으면 `POST /api/character`로 기준 그림을 먼저 올린다. PNG, JPEG, WebP 데이터 URL이고 6MB 안이다. `.gen/character.png` 하나를 덮어쓴다.
- `fal`이 없으면 영상을 만들지 않는다.

`GET /api/live`가 `null`이 아니면 다음 생성을 보내지 않는다. 기준 그림, 올린 참고 영상, 진행 표시(`.gen/live.json`)는 각각 하나다. 결과 폴더만 요청마다 새로 생긴다.

## 방식

기본은 문장참고 `kling`이다. 포즈참고는 브라우저에서 3D 몸을 만들어야 하므로 쓰지 않는다. 영상참고 `puppet`은 3초 이상 10초 이하 영상이 이미 있을 때만 쓰고, 그때 `video`는 `"take"`이다. 영상은 `POST /api/performance`로 올린다. MP4 또는 WebM, 18MB 안이다. 기존 참고 영상을 덮어쓴다.

## 생성 요청

`POST /api/generate-method`

| 필드 | 예 | 규칙 |
| --- | --- | --- |
| `method` | `kling` | 문장참고. 영상참고는 `puppet` |
| `motion` | `punch` | 영문, 숫자, `_`, `-`만. 40자 안 |
| `action` | `주먹을 한 번 내지른다` | 몸이 하는 일. 80자 안 |
| `name` | `주먹` | 진행 제목과 `Name:` 줄. 40자 안 |
| `description` | `""` | 같은 캐릭터의 표식. 없으면 빈 문자열 |
| `style` | `pixel art` | 비우면 `pixel art` |
| `quality` | `standard` | `pro`만 프로다. 빼먹으면 스탠다드다. 스탠다드는 3초에 약 $0.25, 프로는 약 $0.34 |
| `loop` | `false` | 빼먹으면 한 번만 재생한다. 대기, 걷기, 달리기는 `true`를 넣는다 |
| `prompt` | 생략 | 넣으면 서버 문장을 통째로 대체한다. 4000자 안 |

`prompt`를 비우면 서버가 옆모습, 오른쪽을 봄, 발이 한 지면선, 카메라 고정, 기준 그림의 단색 배경 유지를 넣는다.

칸 파일 이름은 `motion`이 아니라 프롬프트의 `Motion: punch` 한 줄에서 읽는다. 그 줄이 없으면 `sprite_00.png`부터다. `punch_00.png`가 필요하면 `prompt`에 `Motion: punch`와 옆모습, 배경 문장을 같이 적는다.

호출은 끝날 때까지 응답하지 않는다. 클라이언트는 15분을 기다린다. 진행은 `GET /api/live`의 `phase`다.

## 결과

성공하면 `.gen/<시각>/`에 남는다.

- `generated.mp4`
- `frames/frame_00.png`부터, 색을 손대기 전 칸
- `sprites/` 아래 8장과 `sheet.png`. 장수는 항상 8이다
- `prompt.txt`, `job.json`

색과 배경은 영상 그대로다. 응답의 칸과 영상 base64는 채팅이나 로그에 붙이지 않는다. `folder`, `model`, `notes`, 칸 크기만 남긴다. 그림은 `GET /api/file?folder=&name=` 또는 `GET /api/history`로 읽는다.

끝난 것의 기준은 응답 200의 `ok`와 `folder`다. 연결이 끊기면 서버 작업은 계속되고 `live`도 남는다. `live`가 `null`이 된 뒤 그 폴더에 `sprites/` 또는 `generated.mp4`가 있으면 성공이다. `live`가 비었다는 것만으로는 성공이 아니다.

## 실패

- 400은 돈이 나가기 전이다. 입력을 고치고 한 번만 다시 보낸다.
- 12분을 넘기면 같은 요청을 다시 보내지 않는다. 서버를 다시 켜면 `job.json`의 같은 작업을 이어서 받고 8칸으로 자른다. 하루가 지난 작업과 `failed: true`는 이어받지 않는다.
- fal이 실패하면 `requestId`를 적고 멈춘다.
- 영상은 저장됐는데 칸 자르기만 실패하면 그 폴더를 알리고 멈춘다. 칸만 다시 자르는 HTTP 입구는 없다.
- 배경만 이상하고 칸은 있으면 `POST /api/clear-backdrop`으로 기존 칸을 고친다.

## 돈이 나가는 호출

시키 전에는 호출하지 않는다.

- `POST /api/generate-method`
- `POST /api/character-draw`
- `POST /api/puppet-frame`, `POST /api/puppet`
- `POST /api/pose-coords`

그림 업로드와 영상 업로드는 돈이 나가지 않는다.

게임 폴더로 복사하는 일, 타격 판정, 투사체는 여기서 만들지 않는다. 결과는 8장의 스프라이트까지다.
