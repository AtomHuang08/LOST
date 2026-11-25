// EC11 tuning knob for the FM radio page.
// The first edge of a detent prints "+" or "-" immediately. The page steps 0.1 MHz.
// Later edges of that same click are ignored, so a quick reversal is not cancelled.
// Clockwise is "+". Swap S1 and S2 if the dial moves the wrong way.
//
// Board: ESP32S3 Dev Module, USB CDC On Boot, 16MB flash, OPI PSRAM.
// Wiring, 3.3 V only: 5V pad -> 3V3, GND -> GND, S1 -> D2, S2 -> D3, KEY -> D4.

static const int PIN_CLK = 5;
static const int PIN_DT = 6;
static const int8_t QUAD[16] = {
  0, -1, 1, 0,
  1, 0, 0, -1,
  -1, 0, 0, 1,
  0, 1, -1, 0
};

uint8_t prev = 0;
uint32_t lastEmit = 0;
uint32_t lastReport = 0;

void setup() {
  pinMode(PIN_CLK, INPUT_PULLUP);
  pinMode(PIN_DT, INPUT_PULLUP);
  prev = readAB();
  Serial.begin(115200);
  delay(200);
  Serial.println("ready");
}

void loop() {
  uint8_t ab = readAB();
  if (ab != prev) {
    int8_t delta = QUAD[(prev << 2) | ab];
    prev = ab;
    if (delta != 0 && millis() - lastEmit >= 16) {
      Serial.println(delta > 0 ? "+" : "-");
      lastEmit = millis();
    }
  }

  if (millis() - lastReport >= 300) {
    lastReport = millis();
    Serial.printf("L %d %d\n", (prev >> 1) & 1, prev & 1);
  }
}

uint8_t readAB() {
  return (digitalRead(PIN_CLK) << 1) | digitalRead(PIN_DT);
}
