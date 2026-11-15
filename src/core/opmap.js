/* ===== core/opmap — производные карты реестра + класс безопасности =====
 * Всё, что здесь есть, выводится из RCSP_REF (data/rcsp-opcodes.json) либо из
 * вендорского JL_rcsp_protocol.h. Никаких «угаданных» опкодов.
 */
const OP_ALL=[...RCSP_REF.opcodes,...RCSP_REF.ota_opcodes];
const OP_BY_CODE=Object.fromEntries(OP_ALL.map(o=>[o.code_int,o]));
const opInfo=c=>OP_BY_CODE[c&255]||null;
const opName=c=>{const o=opInfo(c);return o?(o.name||o.sdk_name):'UNKNOWN_'+hx(c)};
const ATTR_TI=Object.fromEntries(Object.entries(RCSP_REF.attr_types_target_info).map(([k,v])=>[parseInt(k),v]));
const ATTR_CI=Object.fromEntries(Object.entries(RCSP_REF.attr_types_common_info).map(([k,v])=>[parseInt(k),v]));
// JL_PRO_STATUS — вендорский enum. Апстрим-TS (auracast) врёт начиная с 0x02, см. data/bitfields.md §8.
const RCSP_STATUS=Object.fromEntries(Object.entries(RCSP_REF.status_codes.authoritative_sdk).map(([k,v])=>[parseInt(k),v.replace('JL_PRO_STATUS_','')]));
const statusName=s=>RCSP_STATUS[s]||('0x'+(s??0).toString(16).toUpperCase());
const JL_ERR=Object.fromEntries(Object.entries(RCSP_REF.jl_err_transport).map(([k,v])=>[parseInt(k),v]));
const DEV_HANDLERS=Object.fromEntries(Object.entries(RCSP_REF.dev_handlers).map(([k,v])=>[parseInt(k),v]));
const DEV_LIST=[0,1,2,3]; // USB, SD0, SD1, Flash — обход всех устройств (Фаза 2.2)

// Ответы 0xE2 (UPDATE_FLAG_*) и 0xE6 (rcsp_update.c) — из SDK, не из угадываний
const E2_FLAG={0:['OK — обновление возможно','OK — update accepted'],1:['Низкий заряд','Low battery'],2:['Ошибка инфо прошивки','Firmware-info error'],
  3:['Версия совпадает','Same version'],4:['TWS не подключён','TWS not connected'],5:['Не в кейсе','Not in charge-store'],
  6:['Обновление уже идёт','Update already in progress'],7:['Несколько BT-соединений','Multiple BT links']};
const E6_RESULT={0x00:['Успех, готов к перезагрузке','Success, ready to reboot'],0x01:['Ошибка проверки данных','Verify failed'],0x02:['Общий сбой обновления','Update failed'],
  0x03:['Не совпал ключ шифрования (chipkey)','Encryption key mismatch (chipkey)'],0x04:['Ошибка файла обновления','Bad update file'],
  0x05:['Не совпал uboot','uboot mismatch'],0x06:['Ошибка длины','Length error'],0x07:['Ошибка чтения/записи flash','Flash read/write failed'],
  0x08:['Таймаут команды','Command timeout'],0x09:['Тот же файл','Same file'],0x80:['Loader загружен — нужен relink (pass 2)','Loader staged — relink required (pass 2)']};
const e2txt=c=>(E2_FLAG[c]||['Неизвестный код','Unknown code'])[S.set.lang==='en'?1:0];
const e6txt=c=>(E6_RESULT[c]||['Неизвестный код','Unknown code'])[S.set.lang==='en'?1:0];

/* Класс безопасности для сканера и Raw Probe.
   read  — read-only, минимальный payload безопасен;
   write — меняет состояние/файлы устройства: сканер НЕ отправляет;
   danger— необратимые/деструктивные: заблокированы в UI до явного разрешения;
   ota   — машина обновления: E1/E2/E6 read-only, остальные под интерлоком. */
const OP_CLASS={
  0x01:'read',0x02:'read',0x03:'read',0x07:'read',0x0C:'read',0x0D:'read',0x28:'read',0x24:'read',0xD4:'read',0xD6:'read',0xD1:'read',
  0x06:'write',0x08:'write',0x09:'write',0x0A:'write',0x0B:'write',0x0E:'write',0x12:'write',0x13:'write',0x14:'write',0x15:'write',0x19:'write',
  0x1A:'write',0x1B:'write',0x1C:'write',0x1D:'write',0x1E:'write',0x20:'write',0x21:'write',0x25:'write',0x26:'write',0x27:'write',
  0xA0:'read',0xA1:'write',0xA2:'write',0xA3:'read',0xA4:'write',0xA5:'write',0xA6:'write',0xD3:'read',0xD5:'write',0xFF:'read',
  0x1F:'danger',0x22:'danger',0x23:'danger',
  0xE1:'read',0xE2:'read',0xE6:'read',0xE3:'ota',0xE4:'ota',0xE5:'ota',0xE7:'ota',0xE8:'ota'};
const opClass=c=>OP_CLASS[c&255]||'unknown';
// Сканер (Фаза 1.3) отправляет только read/unknown с минимальным payload; всё остальное пропускается с причиной.
const SCAN_ALLOW=new Set([0x02,0x03,0x07,0xE1,0xE2,0xE6]);
const scanAllowed=c=>SCAN_ALLOW.has(c&255);
// Интерлок OTA: эти опкоды не уходят без armOta() (валидный образ + подтверждённый chipkey + фраза)
const OTA_LOCKED=[0xE3,0xE4,0xE5,0xE7,0xE8];
// 9E-namespace: команды часового протокола, которые мы умеем собирать безопасно
const QIX_OPS={0x02:{n:'set_time',cls:'write'},0x16:{n:'display_ctrl',cls:'write'},0x20:{n:'light/0x20',cls:'write'},0x21:{n:'sync_state',cls:'read'},
  0x22:{n:'steps (SDK stub)',cls:'read'},0x23:{n:'sleep (SDK stub)',cls:'read'},0x24:{n:'hr (SDK stub)',cls:'read'},0x25:{n:'pressure (stub)',cls:'read'},
  0x26:{n:'oxygen (stub)',cls:'read'},0x27:{n:'battery',cls:'read'},0x29:{n:'init/heartbeat',cls:'write'},0xC6:{n:'get_screen_info',cls:'read'},
  0xC7:{n:'screen_info (ответ)',cls:'read'},0xDC:{n:'ready',cls:'read'},0xFF:{n:'customer/ack',cls:'read'},
  0xA0:{n:'Qix SET_TEST_MODE (BR35 only)',cls:'danger'},0xAA:{n:'Qix TEST_GET_FLASH (BR35 only)',cls:'danger'},0xA6:{n:'Qix TEST_CLOSE (BR35 only)',cls:'danger'}};
// Health-заглушки: peripherals_support=0 → физических датчиков нет (ТЗ §5.1)
const HEALTH_STUB=new Set([0x22,0x23,0x24,0x25,0x26]);
const SMALL_FILE_TYPES=[{type:1,name:'contacts'},{type:2,name:'sports_record'},{type:3,name:'heart_rate'},{type:4,name:'blood_oxygen'},
  {type:5,name:'sleep'},{type:6,name:'message_sync'},{type:7,name:'weather'},{type:8,name:'call_log'},{type:9,name:'step'}];
