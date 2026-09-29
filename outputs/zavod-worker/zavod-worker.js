var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// Zavod/data.js
var CABLES = [
  { id: "vvgng-p", label: "\u0412\u0412\u0413\u043D\u0433-\u041F", sections: [1.5, 2.5], note: "\u0417\u0430\u0441\u0442\u043E\u0441\u0443\u0432\u0430\u043D\u043D\u044F \u0442\u0430\u0431\u043B\u0438\u0446\u0456 \u0412\u0412\u0413 \u0434\u043E \u0412\u0412\u0413\u043D\u0433-\u041F \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043E \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0435\u043C 29.09.2026." },
  { id: "vvg", label: "\u0412\u0412\u0413", sections: [1.5, 2.5] },
  { id: "pv1", label: "\u041F\u04121 / H07V-U", sections: [1, 1.5, 2.5, 4, 6] },
  { id: "pv3", label: "\u041F\u04123", sections: [0.5, 0.75, 1, 1.5, 2.5, 4, 6], note: "\u0414\u043B\u044F \u0447\u0430\u0441\u0442\u0438\u043D\u0438 \u043F\u0435\u0440\u0435\u0440\u0456\u0437\u0456\u0432 \u0443 \u0437\u0430\u043F\u0438\u0441\u0430\u0445 \u0454 \u0430\u043B\u044C\u0442\u0435\u0440\u043D\u0430\u0442\u0438\u0432\u043D\u0456 \u0440\u0435\u0436\u0438\u043C\u0438, \u0449\u043E \u043F\u043E\u0442\u0440\u0435\u0431\u0443\u044E\u0442\u044C \u0443\u0442\u043E\u0447\u043D\u0435\u043D\u043D\u044F." },
  { id: "ysly", label: "YSLY", sections: [0.5, 0.75, 1, 1.5, 2.5, 4, 6], note: "\u0421\u043F\u0456\u043B\u044C\u043D\u0430 \u0442\u0430\u0431\u043B\u0438\u0446\u044F YSLY / (H)05VV-F \u0443 DRAW_4. \u0420\u0435\u0436\u0438\u043C 1,5 \u043C\u043C\xB2 \u0437 \u043E\u043A\u0440\u0435\u043C\u043E\u0433\u043E \u043B\u0438\u0441\u0442\u0430 H05VV-F \u0441\u044E\u0434\u0438 \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E." },
  { id: "h05vv-f", label: "H05VV-F", sections: [0.5, 0.75, 1, 1.5, 2.5, 4, 6], note: "DRAW_4; \u0434\u043B\u044F 1,5 \u043C\u043C\xB2 \u2014 \u043E\u043A\u0440\u0435\u043C\u0438\u0439 \u0437\u0430\u043F\u0438\u0441 DRAW_6." },
  { id: "pvs-shvvp", label: "\u041F\u0412\u0421 / \u0428\u0412\u0412\u041F", sections: [0.5, 0.75, 1, 1.5, 2.5, 4, 6], note: "\u0420\u0443\u043A\u043E\u043F\u0438\u0441\u043D\u0430 \u0442\u0430\u0431\u043B\u0438\u0446\u044F IMG_3843. \u041D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u0439 \u0440\u044F\u0434\u043E\u043A 6 \u043C\u043C\xB2 \u043D\u0435 \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u043E\u0432\u0443\u0454\u0442\u044C\u0441\u044F." }
];
function recipe(cableId, section, source, values = {}) {
  return {
    id: `${cableId}-${String(section).replace(".", "-")}`,
    cableId,
    section,
    dorn: null,
    matrix: null,
    sikoraWire: null,
    sikoraOuter: null,
    extruder1: null,
    extruder2: null,
    maxSpeed: null,
    mode: "unknown",
    source,
    notes: [],
    uncertain: [],
    ...values
  };
}
__name(recipe, "recipe");
function empty(cableId, section, source, explanation = "\u0420\u044F\u0434\u043E\u043A \u0443 \u0440\u0443\u043A\u043E\u043F\u0438\u0441\u043D\u0456\u0439 \u0442\u0430\u0431\u043B\u0438\u0446\u0456 \u043F\u043E\u0440\u043E\u0436\u043D\u0456\u0439.") {
  return recipe(cableId, section, source, {
    notes: [explanation],
    uncertain: ["\u0423\u0441\u0456 \u0440\u043E\u0431\u043E\u0447\u0456 \u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F: \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043E\u0433\u043E \u0440\u0435\u0436\u0438\u043C\u0443 \u0434\u043B\u044F \u0446\u044C\u043E\u0433\u043E \u043F\u0435\u0440\u0435\u0440\u0456\u0437\u0443 \u043D\u0435\u043C\u0430\u0454."]
  });
}
__name(empty, "empty");
var vvg = [
  recipe("vvg", 1.5, "DRAW_3.JPG", {
    dorn: 1.4,
    matrix: 2.45,
    sikoraWire: 1.37,
    sikoraOuter: 2.6,
    extruder1: 140,
    extruder2: 195,
    maxSpeed: 800,
    mode: "dual",
    notes: ["\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0443 \u0448\u0432\u0438\u0434\u043A\u0456\u0441\u0442\u044C 800 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043E \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0435\u043C 29.09.2026."]
  }),
  recipe("vvg", 2.5, "DRAW_3.JPG", {
    dorn: 1.8,
    matrix: 2.75,
    sikoraWire: 1.75,
    sikoraOuter: 2.88,
    extruder1: 104,
    extruder2: 152,
    maxSpeed: 550,
    mode: "dual",
    notes: ["\u0411\u0456\u043B\u044F \u0448\u0432\u0438\u0434\u043A\u043E\u0441\u0442\u0456 \u0454 \u043E\u043A\u0440\u0435\u043C\u0430 \u043F\u0440\u0438\u043F\u0438\u0441\u043A\u0430 \xAB675 Padana\xBB; \u0443\u043C\u043E\u0432\u0443 \u0457\u0457 \u0437\u0430\u0441\u0442\u043E\u0441\u0443\u0432\u0430\u043D\u043D\u044F \u043D\u0435 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u043E."],
    uncertain: ["\u0414\u043E\u0434\u0430\u0442\u043A\u043E\u0432\u0430 \u0448\u0432\u0438\u0434\u043A\u0456\u0441\u0442\u044C \xAB675 Padana\xBB: \u043D\u0435 \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u043E\u0432\u0443\u0454\u0442\u044C\u0441\u044F \u044F\u043A \u0440\u043E\u0431\u043E\u0447\u0430 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u0434\u043E \u0443\u0442\u043E\u0447\u043D\u0435\u043D\u043D\u044F."]
  })
];
var sharedFlexible = [
  [0.75, { dorn: 1.2, matrix: 1.9, sikoraWire: 1.1, sikoraOuter: 2.05, extruder1: 39, extruder2: 70, maxSpeed: 350 }],
  [1, { dorn: 1.35, matrix: 2.1, sikoraWire: 1.2, sikoraOuter: 2.12, extruder1: 38, extruder2: 95, maxSpeed: 425 }],
  [2.5, { dorn: 2.1, matrix: 3, sikoraWire: 2.1, sikoraOuter: 3.15, extruder1: 86, extruder2: 140, maxSpeed: 400 }],
  [4, { dorn: 2.6, matrix: 3.5, sikoraWire: 2.5, sikoraOuter: 3.68, extruder1: 66, extruder2: 100, maxSpeed: 250 }],
  [6, { dorn: 3.3, matrix: 4.25, sikoraWire: 3.05, sikoraOuter: 4.4, extruder1: 91, extruder2: 156, maxSpeed: 260 }]
];
var RECIPES = [
  ...vvg.map((row) => ({
    ...row,
    id: row.id.replace("vvg-", "vvgng-p-"),
    cableId: "vvgng-p",
    notes: [...row.notes, "\u0420\u0435\u0436\u0438\u043C \u0412\u0412\u0413 \u0437\u0430\u0441\u0442\u043E\u0441\u043E\u0432\u0430\u043D\u043E \u0434\u043E \u0412\u0412\u0413\u043D\u0433-\u041F \u0437\u0430 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043D\u044F\u043C \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 \u0432\u0456\u0434 29.09.2026."],
    uncertain: [...row.uncertain]
  })),
  ...vvg,
  empty("pv1", 1, "DRAW_1.JPG"),
  recipe("pv1", 1.5, "DRAW_1.JPG", {
    dorn: 1.45,
    matrix: 2.8,
    sikoraWire: 1.37,
    sikoraOuter: 2.85,
    extruder1: 75,
    maxSpeed: 320,
    mode: "single",
    notes: ["\u0420\u043E\u0431\u043E\u0442\u0443 \u043B\u0438\u0448\u0435 \u043F\u0435\u0440\u0448\u0438\u043C \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u043E\u043C \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043E \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0435\u043C 29.09.2026; \u043A\u043E\u043B\u043E\u043D\u043A\u0430 E2 \u0443 \u0434\u0436\u0435\u0440\u0435\u043B\u0456 \u043F\u043E\u0440\u043E\u0436\u043D\u044F."]
  }),
  recipe("pv1", 2.5, "DRAW_1.JPG", {
    dorn: 1.8,
    matrix: 3.4,
    sikoraWire: 1.75,
    sikoraOuter: 3.55,
    extruder1: 50,
    maxSpeed: 150,
    mode: "single",
    notes: ["\u0420\u043E\u0431\u043E\u0442\u0443 \u043B\u0438\u0448\u0435 \u043F\u0435\u0440\u0448\u0438\u043C \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u043E\u043C \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043E \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0435\u043C 29.09.2026; \u043A\u043E\u043B\u043E\u043D\u043A\u0430 E2 \u0443 \u0434\u0436\u0435\u0440\u0435\u043B\u0456 \u043F\u043E\u0440\u043E\u0436\u043D\u044F."]
  }),
  empty("pv1", 4, "DRAW_1.JPG"),
  empty("pv1", 6, "DRAW_1.JPG"),
  recipe("pv3", 0.5, "DRAW_5.JPG", {
    dorn: 0.95,
    matrix: 2.2,
    sikoraWire: 1.1,
    sikoraOuter: 2.25,
    extruder1: 58,
    maxSpeed: 350,
    mode: "single",
    notes: ["\u0414\u043E\u0440\u043D 0,95 \u0443 \u0434\u0436\u0435\u0440\u0435\u043B\u0456 \u043E\u0431\u0432\u0435\u0434\u0435\u043D\u043E/\u0432\u0438\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E.", "\u041F\u0435\u0440\u0448\u0430 Sikora 1,1 \u0431\u0456\u043B\u044C\u0448\u0430 \u0437\u0430 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u0438\u0439 \u0434\u043E\u0440\u043D 0,95. \u0417\u043D\u0430\u0447\u0435\u043D\u043D\u044F \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E \u0434\u043E\u0441\u043B\u0456\u0432\u043D\u043E.", "\u0420\u043E\u0431\u043E\u0442\u0443 \u043B\u0438\u0448\u0435 \u043F\u0435\u0440\u0448\u0438\u043C \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u043E\u043C \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043E \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0435\u043C 29.09.2026; \u043A\u043E\u043B\u043E\u043D\u043A\u0430 E2 \u0443 \u0434\u0436\u0435\u0440\u0435\u043B\u0456 \u043F\u043E\u0440\u043E\u0436\u043D\u044F."],
    uncertain: ["\u0414\u043E\u0440\u043D \u0456 \u043F\u0435\u0440\u0448\u0430 Sikora: \u043D\u0435\u043E\u0431\u0445\u0456\u0434\u043D\u043E \u0437\u0432\u0456\u0440\u0438\u0442\u0438 \u0440\u043E\u0437\u0431\u0456\u0436\u043D\u0456\u0441\u0442\u044C 0,95 / 1,1."]
  }),
  recipe("pv3", 0.75, "DRAW_5.JPG", {
    dorn: 1.25,
    matrix: 2.4,
    sikoraWire: 1.25,
    sikoraOuter: 2.5,
    notes: ["\u0411\u0456\u043B\u044F \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0430 1 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043E 68 \u0456 \u043D\u0438\u0436\u0447\u0435 57; \u043F\u043E\u0440\u0443\u0447 \u2014 \xAB65 / 85\xBB. \u0423 \u0448\u0432\u0438\u0434\u043A\u043E\u0441\u0442\u0456 \u2014 350 \u0456 \u043D\u0438\u0436\u0447\u0435 300."],
    uncertain: ["\u0415\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0438 1/2 \u0456 \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430 \u0448\u0432\u0438\u0434\u043A\u0456\u0441\u0442\u044C: \u0437\u0432\u2019\u044F\u0437\u043E\u043A \u043C\u0456\u0436 \u0430\u043B\u044C\u0442\u0435\u0440\u043D\u0430\u0442\u0438\u0432\u043D\u0438\u043C\u0438 \u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F\u043C\u0438 68, 57, 65/85 \u0442\u0430 350/300 \u043D\u0435 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u043E."]
  }),
  recipe("pv3", 1, "DRAW_5.JPG", {
    dorn: 1.35,
    matrix: 2.2,
    sikoraOuter: 2.5,
    extruder1: 50,
    extruder2: 130,
    maxSpeed: 300,
    mode: "dual",
    notes: ["\u041F\u0435\u0440\u0448\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F Sikora \u043F\u0435\u0440\u0435\u043F\u0438\u0441\u0430\u043D\u043E \u043F\u043E\u0432\u0435\u0440\u0445 \u043F\u043E\u043F\u0435\u0440\u0435\u0434\u043D\u044C\u043E\u0433\u043E \u0437\u0430\u043F\u0438\u0441\u0443."],
    uncertain: ["\u041F\u0435\u0440\u0448\u0430 Sikora: \u0432\u0438\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0435 \u0447\u0438\u0441\u043B\u043E \u043D\u0435 \u0447\u0438\u0442\u0430\u0454\u0442\u044C\u0441\u044F \u0434\u043E\u0441\u0442\u0430\u0442\u043D\u044C\u043E \u043D\u0430\u0434\u0456\u0439\u043D\u043E."]
  }),
  recipe("pv3", 1.5, "DRAW_5.JPG", {
    dorn: 1.65,
    matrix: 3,
    sikoraWire: 1.5,
    sikoraOuter: 3.08,
    extruder1: 75,
    maxSpeed: 275,
    mode: "single",
    notes: ["\u0420\u043E\u0431\u043E\u0442\u0443 \u043B\u0438\u0448\u0435 \u043F\u0435\u0440\u0448\u0438\u043C \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u043E\u043C \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043E \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0435\u043C 29.09.2026; \u043A\u043E\u043B\u043E\u043D\u043A\u0430 E2 \u0443 \u0434\u0436\u0435\u0440\u0435\u043B\u0456 \u043F\u043E\u0440\u043E\u0436\u043D\u044F."]
  }),
  recipe("pv3", 2.5, "DRAW_5.JPG", {
    dorn: 2.15,
    matrix: 3.7,
    sikoraWire: 2,
    sikoraOuter: 3.83,
    extruder1: 80,
    extruder2: 100,
    maxSpeed: 210,
    mode: "dual"
  }),
  recipe("pv3", 4, "DRAW_5.JPG", {
    dorn: 2.65,
    matrix: 4.2,
    sikoraWire: 2.5,
    sikoraOuter: 4.35,
    maxSpeed: 150,
    notes: ["\u0414\u043E\u0441\u043B\u0456\u0432\u043D\u0438\u0439 \u0437\u0430\u043F\u0438\u0441 \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0456\u0432: \xAB74 (64 / 80)\xBB."],
    uncertain: ["\u0415\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0438 1/2 \u0456 \u0440\u0435\u0436\u0438\u043C \u0440\u043E\u0431\u043E\u0442\u0438: \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u043E \u043F\u043E\u044F\u0441\u043D\u0438\u0442\u0438 \u0432\u0438\u0431\u0456\u0440 \u043C\u0456\u0436 74 \u0442\u0430 \u043F\u0430\u0440\u043E\u044E 64/80."]
  }),
  recipe("pv3", 6, "DRAW_5.JPG", {
    dorn: 3.1,
    matrix: 4.7,
    sikoraWire: 3,
    sikoraOuter: 4.82,
    notes: ["\u0414\u043E\u0441\u043B\u0456\u0432\u043D\u0438\u0439 \u0437\u0430\u043F\u0438\u0441 \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0456\u0432: \xAB67 (64 / 84)\xBB; \u0443 \u0448\u0432\u0438\u0434\u043A\u043E\u0441\u0442\u0456 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043E 120 \u0456 \u043D\u0438\u0436\u0447\u0435 130."],
    uncertain: ["\u0415\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0438 1/2 \u0456 \u0440\u0435\u0436\u0438\u043C \u0440\u043E\u0431\u043E\u0442\u0438: \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u043E \u043F\u043E\u044F\u0441\u043D\u0438\u0442\u0438 \u0432\u0438\u0431\u0456\u0440 \u043C\u0456\u0436 67 \u0442\u0430 \u043F\u0430\u0440\u043E\u044E 64/84.", "\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430 \u0448\u0432\u0438\u0434\u043A\u0456\u0441\u0442\u044C: \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u0456 120 \u0442\u0430 130 \u0431\u0435\u0437 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u043D\u044F \u0443\u043C\u043E\u0432."]
  }),
  ...["ysly", "h05vv-f"].flatMap((cableId) => [
    empty(cableId, 0.5, "DRAW_4.JPG"),
    ...sharedFlexible.map(([section, values]) => recipe(cableId, section, "DRAW_4.JPG", { ...values, mode: "dual" }))
  ]),
  empty("ysly", 1.5, "DRAW_4.JPG", "\u0420\u044F\u0434\u043E\u043A YSLY 1,5 \u043C\u043C\xB2 \u043F\u043E\u0440\u043E\u0436\u043D\u0456\u0439. \u041E\u043A\u0440\u0435\u043C\u0438\u0439 \u0437\u0430\u043F\u0438\u0441 H05VV-F \u0456\u0437 DRAW_6 \u043D\u0435 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0443\u0454 \u0446\u0435\u0439 \u0440\u0435\u0436\u0438\u043C \u0434\u043B\u044F YSLY."),
  recipe("h05vv-f", 1.5, "DRAW_6.JPG", {
    dorn: 1.7,
    matrix: 2.8,
    sikoraWire: 1.5,
    sikoraOuter: 2.98,
    extruder1: 70,
    extruder2: 112,
    maxSpeed: 325,
    mode: "dual"
  }),
  empty("pvs-shvvp", 0.5, "IMG_3843.JPG"),
  recipe("pvs-shvvp", 0.75, "IMG_3843.JPG", {
    dorn: 1.2,
    matrix: 2,
    sikoraWire: 1.12,
    sikoraOuter: 2.1,
    extruder1: 60,
    extruder2: 100,
    maxSpeed: 550,
    mode: "dual"
  }),
  empty("pvs-shvvp", 1, "IMG_3843.JPG"),
  recipe("pvs-shvvp", 1.5, "IMG_3843.JPG", {
    dorn: 1.65,
    matrix: 2.7,
    sikoraWire: 1.53,
    sikoraOuter: 2.8,
    extruder1: 81,
    extruder2: 118,
    maxSpeed: 400,
    mode: "dual",
    colorLead2: 2e3,
    notes: ["\u041F\u0456\u0434 \u043A\u043E\u043B\u043E\u043D\u043A\u043E\u044E \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0430 \u0454 \u0437\u0430\u043F\u0438\u0441 \xAB\u043A\u043E\u043B\u0456\u0440 2000\xBB \u2014 \u043E\u0440\u0456\u0454\u043D\u0442\u0438\u0440 \u0437\u043C\u0456\u043D\u0438 \u043A\u043E\u043B\u044C\u043E\u0440\u0443 \u0437\u0430 2000 \u043C."]
  }),
  recipe("pvs-shvvp", 2.5, "IMG_3843.JPG", {
    dorn: 2.1,
    matrix: 3.4,
    sikoraWire: 1.97,
    sikoraOuter: 3.55,
    extruder1: 78,
    extruder2: 100,
    maxSpeed: 240,
    mode: "dual",
    colorLead2: 1500,
    notes: ["\u041F\u0456\u0434 \u043A\u043E\u043B\u043E\u043D\u043A\u043E\u044E \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0430 \u0454 \u0437\u0430\u043F\u0438\u0441 \xAB\u043A\u043E\u043B\u0456\u0440 1500\xBB \u2014 \u043E\u0440\u0456\u0454\u043D\u0442\u0438\u0440 \u0437\u043C\u0456\u043D\u0438 \u043A\u043E\u043B\u044C\u043E\u0440\u0443 \u0437\u0430 1500 \u043C."]
  }),
  empty("pvs-shvvp", 4, "IMG_3843.JPG"),
  empty("pvs-shvvp", 6, "IMG_3843.JPG", "\u0420\u044F\u0434\u043E\u043A \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u0439 \u0456 \u043F\u043E\u0432\u0442\u043E\u0440\u044E\u0454 \u043E\u043A\u0440\u0435\u043C\u0456 \u0447\u0438\u0441\u043B\u0430 \u0437 2,5 \u043C\u043C\xB2. \u0419\u043E\u0433\u043E \u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F \u043D\u0435 \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u043E\u0432\u0443\u044E\u0442\u044C\u0441\u044F \u0434\u043E \u0443\u0442\u043E\u0447\u043D\u0435\u043D\u043D\u044F.")
];

// Zavod/core.js
var COLORS = [
  { id: "blue", label: "\u0421\u0438\u043D\u0456\u0439", hex: "#3874bc" },
  { id: "brown", label: "\u041A\u043E\u0440\u0438\u0447\u043D\u0435\u0432\u0438\u0439", hex: "#916044" },
  { id: "yellow-green", label: "\u0416\u043E\u0432\u0442\u043E-\u0437\u0435\u043B\u0435\u043D\u0438\u0439", hex: "#dbc844" },
  { id: "black", label: "\u0427\u043E\u0440\u043D\u0438\u0439", hex: "#303534" },
  { id: "white", label: "\u0411\u0456\u043B\u0438\u0439", hex: "#f5f4ee" },
  { id: "gray", label: "\u0421\u0456\u0440\u0438\u0439", hex: "#939b99" },
  { id: "red", label: "\u0427\u0435\u0440\u0432\u043E\u043D\u0438\u0439", hex: "#c84e47" },
  { id: "green", label: "\u0417\u0435\u043B\u0435\u043D\u0438\u0439", hex: "#528463" },
  { id: "yellow", label: "\u0416\u043E\u0432\u0442\u0438\u0439", hex: "#dcc447" }
];
var DEFAULT_RULES = Object.freeze({ bath: 150, reserve: 1e3, lead2: 2e3, lead1: 300, splice: 30, sikoraOffset: 0.15 });

// api/zavod-worker.js
var NUMERIC = ["dorn", "matrix", "sikoraWire", "sikoraOuter", "extruder1", "extruder2", "maxSpeed", "colorLead2"];
var encoder = new TextEncoder();
var MAX_AGE = 12 * 60 * 60;
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var fail = /* @__PURE__ */ __name((status, message) => {
  throw new HttpError(status, message);
}, "fail");
var hexBytes = /* @__PURE__ */ __name((hex) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16)), "hexBytes");
async function verifyTelegram(initData, botToken, now = Math.floor(Date.now() / 1e3)) {
  if (!botToken || typeof initData !== "string" || initData.length > 12e3) return null;
  const params = new URLSearchParams(initData);
  if ([...params.keys()].some((key, i, keys) => keys.indexOf(key) !== i)) return null;
  const hash = params.get("hash");
  if (!/^[a-f\d]{64}$/i.test(hash ?? "")) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0 || now - authDate > MAX_AGE || authDate - now > 60) return null;
  params.delete("hash");
  const data = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("\n");
  try {
    const seed = await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const secret = await crypto.subtle.sign("HMAC", seed, encoder.encode(botToken));
    const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, hexBytes(hash), encoder.encode(data))) return null;
    const user = JSON.parse(params.get("user") ?? "{}");
    if (!Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) return null;
    return user;
  } catch {
    return null;
  }
}
__name(verifyTelegram, "verifyTelegram");
async function admin(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) fail(503, "\u0412\u0445\u0456\u0434 \u0449\u0435 \u043D\u0435 \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u0438\u0439.");
  const user = await verifyTelegram(request.headers.get("X-Telegram-Init-Data"), env.TELEGRAM_BOT_TOKEN);
  if (!user) fail(401, "\u0412\u0456\u0434\u043A\u0440\u0438\u0439\u0442\u0435 \u0437\u0430\u0441\u0442\u043E\u0441\u0443\u043D\u043E\u043A \u0437\u0430\u043D\u043E\u0432\u043E \u0447\u0435\u0440\u0435\u0437 Telegram.");
  const owner = await env.DB.prepare("SELECT value FROM settings WHERE name = ?").bind("owner_id").first();
  if (owner) {
    if (owner.value !== String(user.id)) fail(403, "\u0417\u0430\u043F\u0438\u0441\u0443\u0432\u0430\u0442\u0438 \u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F \u043C\u043E\u0436\u0435 \u043B\u0438\u0448\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u043A.");
  } else {
    const expected = String(env.OWNER_USERNAME || "").replace(/^@/, "").toLowerCase();
    if (!expected || String(user.username || "").toLowerCase() !== expected) fail(403, "\u0417\u0430\u043F\u0438\u0441\u0443\u0432\u0430\u0442\u0438 \u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F \u043C\u043E\u0436\u0435 \u043B\u0438\u0448\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u043A.");
    await env.DB.prepare("INSERT INTO settings(name, value) VALUES(?, ?) ON CONFLICT(name) DO NOTHING").bind("owner_id", String(user.id)).run();
    const pinned = await env.DB.prepare("SELECT value FROM settings WHERE name = ?").bind("owner_id").first();
    if (pinned?.value !== String(user.id)) fail(403, "\u0414\u043E\u0441\u0442\u0443\u043F \u043D\u0430\u043B\u0435\u0436\u0438\u0442\u044C \u0456\u043D\u0448\u043E\u043C\u0443 \u0430\u043A\u0430\u0443\u043D\u0442\u0443.");
  }
  return user;
}
__name(admin, "admin");
async function bodyJson(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) fail(415, "\u041F\u043E\u0442\u0440\u0456\u0431\u043D\u0456 \u0434\u0430\u043D\u0456 JSON.");
  if (Number(request.headers.get("Content-Length") || 0) > 2e4) fail(413, "\u0417\u0430\u043F\u0438\u0441 \u0437\u0430\u0432\u0435\u043B\u0438\u043A\u0438\u0439.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "\u041F\u043E\u0440\u043E\u0436\u043D\u0456\u0439 \u0437\u0430\u043F\u0438\u0441.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2e4) {
      await reader.cancel();
      fail(413, "\u0417\u0430\u043F\u0438\u0441 \u0437\u0430\u0432\u0435\u043B\u0438\u043A\u0438\u0439.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 \u0437\u0430\u043F\u0438\u0441.");
    return data;
  } catch {
    fail(400, "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 \u0437\u0430\u043F\u0438\u0441.");
  }
}
__name(bodyJson, "bodyJson");
function validateMeasurement(input) {
  const base = RECIPES.find((row) => row.id === input.baseId);
  if (!base) fail(400, "\u041E\u0431\u0435\u0440\u0456\u0442\u044C \u043C\u0430\u0440\u043A\u0443 \u0442\u0430 \u043F\u0435\u0440\u0435\u0440\u0456\u0437 \u0456\u0437 \u0442\u0430\u0431\u043B\u0438\u0446\u0456.");
  if (!/^[a-f\d-]{36}$/i.test(input.id ?? "")) fail(400, "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 \u043D\u043E\u043C\u0435\u0440 \u0437\u0430\u043F\u0438\u0441\u0443.");
  if (input.color !== "all" && !COLORS.some((color) => color.id === input.color)) fail(400, "\u041E\u0431\u0435\u0440\u0456\u0442\u044C \u043A\u043E\u043B\u0456\u0440.");
  if (!["single", "dual", "unknown"].includes(input.mode)) fail(400, "\u041E\u0431\u0435\u0440\u0456\u0442\u044C \u0440\u0435\u0436\u0438\u043C \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0456\u0432.");
  if (typeof input.note !== "string" || input.note.length > 2e3) fail(400, "\u041F\u0440\u0438\u043C\u0456\u0442\u043A\u0430 \u043C\u0430\u0454 \u043C\u0456\u0441\u0442\u0438\u0442\u0438 \u0434\u043E 2000 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432.");
  const result = { id: input.id, baseId: base.id, cableId: base.cableId, section: base.section, color: input.color, mode: input.mode, note: input.note.trim() };
  for (const field of NUMERIC) {
    const value = input[field];
    if (value === null || value === void 0 || value === "") {
      result[field] = null;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1e5) fail(400, "\u0417\u043D\u0430\u0447\u0435\u043D\u043D\u044F \u043C\u0430\u044E\u0442\u044C \u0431\u0443\u0442\u0438 \u0434\u043E\u0434\u0430\u0442\u043D\u0438\u043C\u0438 \u0447\u0438\u0441\u043B\u0430\u043C\u0438.");
    if (["dorn", "matrix", "sikoraWire", "sikoraOuter"].includes(field) && value > 1e3) fail(400, "\u041F\u0435\u0440\u0435\u0432\u0456\u0440\u0442\u0435 \u0434\u0456\u0430\u043C\u0435\u0442\u0440\u0438: \u043E\u0434\u0438\u043D\u0438\u0446\u044F \u0432\u0438\u043C\u0456\u0440\u044E\u0432\u0430\u043D\u043D\u044F \u2014 \u043C\u043C.");
    result[field] = value;
  }
  if (result.mode === "single") result.extruder2 = null;
  if (!result.note && !NUMERIC.some((key) => result[key] !== null)) fail(400, "\u0414\u043E\u0434\u0430\u0439\u0442\u0435 \u0445\u043E\u0447\u0430 \u0431 \u043E\u0434\u043D\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F \u0430\u0431\u043E \u043F\u0440\u0438\u043C\u0456\u0442\u043A\u0443.");
  return result;
}
__name(validateMeasurement, "validateMeasurement");
function unpack(row) {
  return { ...JSON.parse(row.data), id: row.id, revision: row.revision, updatedAt: row.updated_at };
}
__name(unpack, "unpack");
async function handleRequest(request, env) {
  const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
  if (request.method === "GET" && path === "/catalog") {
    const { results } = await env.DB.prepare("SELECT * FROM recipes ORDER BY base_id, color").all();
    return { cables: CABLES, recipes: results.map(unpack), updatedAt: results.reduce((last, row) => row.updated_at > last ? row.updated_at : last, ""), source: "server" };
  }
  if (!path.startsWith("/admin/")) fail(404, "\u0421\u0442\u043E\u0440\u0456\u043D\u043A\u0443 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
  const user = await admin(request, env);
  if (request.method === "POST" && path === "/admin/auth") return { ok: true, username: user.username || env.OWNER_USERNAME };
  if (request.method === "GET" && path === "/admin/measurements") {
    const before = new URL(request.url).searchParams.get("before") || "9999";
    const { results } = await env.DB.prepare("SELECT * FROM measurements WHERE created_at < ? ORDER BY created_at DESC, id DESC LIMIT 101").bind(before).all();
    return { measurements: results.slice(0, 100).map((row) => ({ ...JSON.parse(row.data), createdAt: row.created_at })), next: results.length > 100 ? results[99].created_at : null };
  }
  if (request.method === "POST" && path === "/admin/measurements") {
    const measurement = validateMeasurement(await bodyJson(request));
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const result = await env.DB.prepare("INSERT INTO measurements(id, base_id, color, data, created_at, created_by) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(measurement.id, measurement.baseId, measurement.color, JSON.stringify(measurement), now, String(user.id)).run();
    if (!result.meta.changes) {
      const existing = await env.DB.prepare("SELECT data, created_at FROM measurements WHERE id = ?").bind(measurement.id).first();
      if (existing.data !== JSON.stringify(measurement)) fail(409, "\u0417\u0430\u043F\u0438\u0441 \u0456\u0437 \u0446\u0438\u043C \u043D\u043E\u043C\u0435\u0440\u043E\u043C \u0443\u0436\u0435 \u0456\u0441\u043D\u0443\u0454.");
      return { measurement: { ...measurement, createdAt: existing.created_at } };
    }
    return { measurement: { ...measurement, createdAt: now } };
  }
  if (request.method === "PUT" && path.startsWith("/admin/recipes/")) {
    const payload = await bodyJson(request);
    const id = decodeURIComponent(path.slice("/admin/recipes/".length));
    if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) fail(400, "\u041E\u043D\u043E\u0432\u0456\u0442\u044C \u0442\u0430\u0431\u043B\u0438\u0446\u044E \u043F\u0435\u0440\u0435\u0434 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043D\u044F\u043C.");
    const stored = await env.DB.prepare("SELECT data, created_at FROM measurements WHERE id = ?").bind(String(payload.measurementId)).first();
    if (!stored) fail(404, "\u0417\u0430\u043C\u0456\u0440 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    const measurement = JSON.parse(stored.data);
    const expectedId = measurement.color === "all" ? measurement.baseId : `${measurement.baseId}~${measurement.color}`;
    if (id !== expectedId) fail(400, "\u0417\u0430\u043C\u0456\u0440 \u043D\u0430\u043B\u0435\u0436\u0438\u0442\u044C \u0456\u043D\u0448\u043E\u043C\u0443 \u043F\u0440\u043E\u0432\u043E\u0434\u0443 \u0430\u0431\u043E \u043A\u043E\u043B\u044C\u043E\u0440\u0443.");
    if (measurement.mode === "unknown") fail(400, "\u041F\u0435\u0440\u0435\u0434 \u0437\u0430\u0441\u0442\u043E\u0441\u0443\u0432\u0430\u043D\u043D\u044F\u043C \u043E\u0431\u0435\u0440\u0456\u0442\u044C \u043A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044C \u0435\u043A\u0441\u0442\u0440\u0443\u0434\u0435\u0440\u0456\u0432.");
    const original = RECIPES.find((row) => row.id === measurement.baseId);
    const data = { ...measurement, id, measurementId: measurement.id, source: original.source, origin: "measurement", notes: measurement.note ? [measurement.note] : [], uncertain: [] };
    const previous = await env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first();
    if (previous && JSON.parse(previous.data).measurementId === measurement.id) return { recipe: unpack(previous) };
    if ((previous?.revision ?? 0) !== payload.expectedRevision) fail(409, "\u0426\u0435\u0439 \u0440\u044F\u0434\u043E\u043A \u0443\u0436\u0435 \u0437\u043C\u0456\u043D\u0438\u0432\u0441\u044F. \u0417\u0430\u043C\u0456\u0440 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u0438\u0439; \u043E\u043D\u043E\u0432\u0456\u0442\u044C \u0442\u0430\u0431\u043B\u0438\u0446\u044E \u043F\u0435\u0440\u0435\u0434 \u0437\u0430\u0441\u0442\u043E\u0441\u0443\u0432\u0430\u043D\u043D\u044F\u043C.");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const updated = await env.DB.prepare(`INSERT INTO recipes(id, base_id, color, data, revision, updated_at)
      SELECT ?, ?, ?, ?, 1, ? WHERE ? = 0 OR EXISTS(SELECT 1 FROM recipes WHERE id = ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, revision = recipes.revision + 1, updated_at = excluded.updated_at WHERE recipes.revision = ?
      RETURNING *`).bind(id, measurement.baseId, measurement.color, JSON.stringify(data), now, payload.expectedRevision, id, payload.expectedRevision).first();
    if (!updated) fail(409, "\u0426\u0435\u0439 \u0440\u044F\u0434\u043E\u043A \u0443\u0436\u0435 \u0437\u043C\u0456\u043D\u0438\u0432\u0441\u044F. \u0417\u0430\u043C\u0456\u0440 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u0438\u0439; \u043E\u043D\u043E\u0432\u0456\u0442\u044C \u0442\u0430\u0431\u043B\u0438\u0446\u044E \u043F\u0435\u0440\u0435\u0434 \u0437\u0430\u0441\u0442\u043E\u0441\u0443\u0432\u0430\u043D\u043D\u044F\u043C.");
    return { recipe: unpack(updated) };
  }
  if (request.method === "GET" && path.startsWith("/admin/history/")) {
    const id = decodeURIComponent(path.slice("/admin/history/".length));
    const { results } = await env.DB.prepare("SELECT revision, data, recorded_at FROM recipe_history WHERE recipe_id = ? ORDER BY revision DESC LIMIT 100").bind(id).all();
    return { history: results.map((row) => ({ ...JSON.parse(row.data), revision: row.revision, updatedAt: row.recorded_at })) };
  }
  fail(404, "\u0414\u0456\u044E \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
}
__name(handleRequest, "handleRequest");
var zavod_worker_default = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim());
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
    if (origin && !allowed.includes(origin)) return new Response(JSON.stringify({ error: "\u0426\u0435\u0439 \u0441\u0430\u0439\u0442 \u043D\u0435 \u043C\u0430\u0454 \u0434\u043E\u0441\u0442\u0443\u043F\u0443." }), { status: 403, headers });
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Telegram-Init-Data";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      return new Response(JSON.stringify(await handleRequest(request, env)), { headers });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(JSON.stringify({ event: "zavod_request_failed", path: new URL(request.url).pathname }));
      return new Response(JSON.stringify({ error: status === 500 ? "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0437\u0431\u0435\u0440\u0435\u0433\u0442\u0438. \u0421\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0449\u0435 \u0440\u0430\u0437." : error.message }), { status, headers });
    }
  }
};
export {
  zavod_worker_default as default,
  handleRequest,
  validateMeasurement,
  verifyTelegram
};
//# sourceMappingURL=zavod-worker.js.map
