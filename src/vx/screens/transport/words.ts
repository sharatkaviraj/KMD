import type { Problem, Shift } from "@/modules/transport/domain/board";
import { p, type Pair } from "@/vx/text";

/*
 * Every word on the Transport screen (D-550), in English and Hindi. Plain
 * words for office staff: "bus", "route", "driver", "children", never a
 * database name.
 */

export const W = {
  title: p("Transport", "परिवहन"),
  crumb: p("Children & staff · Transport", "बच्चे व स्टाफ़ · परिवहन"),
  lead: p(
    "Which children ride each route, when each bus leaves, and who drives it.",
    "कौन-से बच्चे किस रूट पर हैं, हर बस कब निकलती है, और उसे कौन चलाता है।",
  ),

  tabs: {
    routes: p("Routes", "रूट"),
    times: p("Bus times", "बस का समय"),
    drivers: p("Drivers", "ड्राइवर"),
  },
  tabsLabel: p("What to show", "क्या दिखाएँ"),

  kpi: {
    riders: p("Children on buses", "बस वाले बच्चे"),
    routes: p("Routes in use", "चालू रूट"),
    trips: p("Bus runs", "बस के फेरे"),
    drivers: p("Drivers", "ड्राइवर"),
  },
  kpiSub: {
    riders: (n: number) => p(`${n} of them on a route below`, `इनमें से ${n} नीचे के रूट पर`),
    routes: (quiet: number) =>
      quiet ? p(`${quiet} more with no children`, `${quiet} और रूट पर कोई बच्चा नहीं`) : p("With children on them", "जिन पर बच्चे हैं"),
    trips: (m: number, a: number) => p(`${m} morning · ${a} afternoon`, `${m} सुबह · ${a} दोपहर`),
    tripsNone: p("None added yet", "अभी कोई नहीं जोड़ा"),
    drivers: (n: number) => p(`${n} without a bus`, `${n} के पास कोई बस नहीं`),
    driversAll: p("Each has a bus", "हर एक के पास बस है"),
  },

  search: p("Search a child, route, bus or driver", "बच्चा, रूट, बस या ड्राइवर खोजें"),
  childrenFound: (n: number) => p(`${n} ${n === 1 ? "child" : "children"} found`, `${n} बच्चे मिले`),
  nothingFound: p("Nothing matches that search.", "इस खोज से कुछ नहीं मिला।"),
  clearSearch: p("Clear the search", "खोज हटाएँ"),

  shift: {
    morning: p("Morning", "सुबह"),
    afternoon: p("Afternoon", "दोपहर"),
    other: p("Other", "अन्य"),
  } satisfies Record<Shift, Pair>,
  shiftLong: {
    morning: p("Morning pickup", "सुबह बच्चों को लाना"),
    afternoon: p("Afternoon drop", "दोपहर बच्चों को छोड़ना"),
    other: p("Other runs", "अन्य फेरे"),
  } satisfies Record<Shift, Pair>,
  all: p("All", "सभी"),

  /* Routes */
  children: (n: number) => p(`${n} ${n === 1 ? "child" : "children"}`, `${n} बच्चे`),
  noChildren: p("No children", "कोई बच्चा नहीं"),
  unnamed: p("Route not named yet", "रूट का नाम अभी नहीं आया"),
  noMorningBus: p("No morning bus yet", "अभी सुबह की बस नहीं"),
  noAfternoonBus: p("No afternoon bus yet", "अभी दोपहर की बस नहीं"),
  noBusYet: p("No bus set for this route yet", "इस रूट के लिए अभी कोई बस तय नहीं"),
  filterNoMorning: p("No morning bus", "सुबह की बस नहीं"),
  filterNoAfternoon: p("No afternoon bus", "दोपहर की बस नहीं"),
  quietRoutes: (n: number) => p(`${n} more ${n === 1 ? "route has" : "routes have"} no children this year.`, `${n} और रूट पर इस साल कोई बच्चा नहीं है।`),
  noDriver: p("No driver yet", "अभी ड्राइवर नहीं"),

  /* Bus times */
  leaves: (time: Pair) => p(`Leaves ${time.en}`, `${time.hi} निकलती है`),
  busCarries: (n: number) => p(`Carries ${n} ${n === 1 ? "child" : "children"}`, `${n} बच्चे जाते हैं`),
  stopsLine: (n: number) => p(`${n} ${n === 1 ? "route" : "routes"} on the way`, `रास्ते में ${n} रूट`),
  noTrips: p("No bus times added yet", "अभी कोई बस का समय नहीं जोड़ा"),
  noTripsBody: p(
    "Add each bus run once: when it leaves, its driver, and the routes it goes to in order. Then every route shows its bus and driver here.",
    "हर बस का फेरा एक बार जोड़ें: कब निकलती है, कौन चलाता है, और किन रूट पर किस क्रम में जाती है। फिर हर रूट पर उसकी बस और ड्राइवर यहाँ दिखेंगे।",
  ),
  filterNoDriver: p("No driver", "ड्राइवर नहीं"),
  seeChildren: p("See the children", "बच्चे देखें"),
  driver: p("Driver", "ड्राइवर"),
  helper: p("Helper", "हेल्पर"),
  bus: p("Bus", "बस"),
  call: p("Call", "कॉल करें"),
  callWho: (name: string) => p(`Call ${name}`, `${name} को कॉल करें`),

  /* Drivers */
  addDriver: p("Add a driver", "ड्राइवर जोड़ें"),
  noDrivers: p("No drivers added yet", "अभी कोई ड्राइवर नहीं जोड़ा"),
  noDriversBody: p("Add each driver once, with a phone number, and choose them when you add a bus.", "हर ड्राइवर को एक बार फ़ोन नंबर के साथ जोड़ें, फिर बस जोड़ते समय उन्हें चुनें।"),
  drives: p("Drives", "चलाते हैं"),
  noBusForDriver: p("No bus given yet", "अभी कोई बस नहीं दी"),
  noPhone: p("No phone number", "फ़ोन नंबर नहीं"),

  /* Setup and sources */
  notReady: p(
    "Bus times and drivers are being set up and open here soon. You can already see which children ride each route.",
    "बस का समय और ड्राइवर अभी तैयार हो रहे हैं, जल्दी यहीं खुलेंगे। कौन-से बच्चे किस रूट पर हैं, यह अभी से दिख रहा है।",
  ),
  namesMissing: p(
    "Route names could not be read from the Fees app just now, so some routes show without a name. Try again in a few minutes.",
    "अभी फीस ऐप से रूट के नाम नहीं मिल सके, इसलिए कुछ रूट बिना नाम के दिख रहे हैं। कुछ मिनट बाद फिर देखें।",
  ),
  refreshNames: p("Get route names again", "रूट के नाम फिर से लाएँ"),
  refreshing: p("Getting route names…", "रूट के नाम आ रहे हैं…"),
  refreshed: (n: number) => p(`Route names updated: ${n} routes`, `रूट के नाम अपडेट हुए: ${n} रूट`),
  refreshRecent: (m: number) => p(`Route names were just updated. Try again in ${m} min.`, `रूट के नाम अभी-अभी अपडेट हुए। ${m} मिनट बाद फिर कोशिश करें।`),
  refreshFailed: p("Could not reach the Fees app. Try again in a few minutes.", "फीस ऐप तक नहीं पहुँच सके। कुछ मिनट बाद फिर कोशिश करें।"),
  fromFees: p("Routes and the children on them come from the Fees app. Change a child's route there.", "रूट और उन पर बच्चे फीस ऐप से आते हैं। बच्चे का रूट वहीं बदलें।"),
  readOnly: p("You can see the buses. Ask the office or an administrator to change them.", "आप बसें देख सकते हैं। बदलने के लिए कार्यालय या प्रशासक से कहें।"),
  noSession: p("No school year is open", "कोई सत्र खुला नहीं है"),
  noSessionBody: p("Choose a year from the year button at the top.", "ऊपर साल वाले बटन से साल चुनें।"),
  couldNotLoad: p("The transport list could not be loaded. Pull down or try again in a minute.", "परिवहन सूची नहीं खुल सकी। नीचे खींचें या एक मिनट बाद फिर कोशिश करें।"),

  /* Still to do */
  todo: p("Still to do", "अभी बाकी"),
  todoNoMorning: (n: number) => p(`${n} ${n === 1 ? "route has" : "routes have"} no morning bus`, `${n} रूट पर सुबह की बस नहीं`),
  todoNoAfternoon: (n: number) => p(`${n} ${n === 1 ? "route has" : "routes have"} no afternoon bus`, `${n} रूट पर दोपहर की बस नहीं`),
  todoNoDriver: (n: number) => p(`${n} ${n === 1 ? "bus has" : "buses have"} no driver`, `${n} बस में ड्राइवर नहीं`),
  show: p("Show", "दिखाएँ"),
  startHere: p("Start here", "यहाँ से शुरू करें"),
  startBody: p(
    "1. Add your drivers.  2. Add each bus: its time, driver and routes.  3. Every route then shows its bus, and every bus its children.",
    "1. अपने ड्राइवर जोड़ें।  2. हर बस जोड़ें: समय, ड्राइवर और रूट।  3. फिर हर रूट पर उसकी बस और हर बस में उसके बच्चे दिखेंगे।",
  ),

  /* Sheets */
  busesHere: p("Buses that come here", "यहाँ आने वाली बसें"),
  noBusHere: p("No bus comes to this route yet.", "अभी इस रूट पर कोई बस नहीं आती।"),
  addBusHere: p("Add a bus for this route", "इस रूट के लिए बस जोड़ें"),
  childrenOnRoute: p("Children on this route", "इस रूट के बच्चे"),
  childrenOnBus: p("Children on this bus, route by route", "इस बस के बच्चे, रूट के क्रम से"),
  sr: (no: string) => p(`SR ${no}`, `SR ${no}`),
  stopAt: (time: Pair) => p(`at ${time.en}`, `${time.hi} बजे`),
  makeReturn: p("Make the afternoon run from this", "इससे दोपहर का फेरा बनाएँ"),
  makeMorning: p("Make the morning run from this", "इससे सुबह का फेरा बनाएँ"),
  edit: p("Change", "बदलें"),
  close: p("Close", "बंद करें"),

  /* Trip editor */
  addBus: p("Add a bus", "बस जोड़ें"),
  changeBus: p("Change this bus", "यह बस बदलें"),
  editorSub: p("One bus run at one time of day.", "दिन के एक समय का एक फेरा।"),
  when: p("When does it run?", "यह कब चलती है?"),
  leavesAt: p("Leaves school / first stop at", "स्कूल या पहले रूट से निकलने का समय"),
  leavesHint: p("Tap the box and pick the time, for example 7:05 am", "बॉक्स दबाकर समय चुनें, जैसे सुबह 7:05"),
  busName: p("Bus name", "बस का नाम"),
  busNameHint: p("What staff call it: Bus 1, Big bus, Van…", "स्टाफ़ इसे जो कहता है: बस 1, बड़ी बस, वैन…"),
  busNameExample: p("Bus 1", "बस 1"),
  vehicleNo: p("Bus number plate (if you know it)", "बस का नंबर (अगर पता हो)"),
  whoDrives: p("Who drives it?", "इसे कौन चलाता है?"),
  pickDriver: p("Choose a driver", "ड्राइवर चुनें"),
  noDriverYet: p("No driver yet", "अभी ड्राइवर नहीं"),
  newDriver: p("+ A new driver", "+ नया ड्राइवर"),
  newDriverName: p("New driver's name", "नए ड्राइवर का नाम"),
  newDriverHint: p("They join your list of drivers when you save the bus.", "बस सहेजते ही वे ड्राइवर की सूची में जुड़ जाएँगे।"),
  alsoDrives: (buses: string) => p(`Also drives: ${buses}`, `ये भी चलाते हैं: ${buses}`),
  phone: p("Phone number", "फ़ोन नंबर"),
  phoneHint: p("10 digits", "10 अंक"),
  helperName: p("Helper's name (if there is one)", "हेल्पर का नाम (अगर हो)"),
  helperPhone: p("Helper's phone", "हेल्पर का फ़ोन"),
  routesInOrder: p("Routes, in the order the bus goes", "रूट, जिस क्रम में बस जाती है"),
  routesHint: p("Add each route the bus reaches. Use the arrows to put them in order. A time for each is optional.", "बस जिन रूट पर जाती है, उन्हें जोड़ें। तीर से क्रम ठीक करें। हर रूट का समय डालना ज़रूरी नहीं।"),
  addRoute: p("Add a route", "रूट जोड़ें"),
  pickRoute: p("Which route does the bus go to next?", "बस आगे किस रूट पर जाती है?"),
  findRoute: p("Find a route", "रूट खोजें"),
  allAdded: p("Every route is already on this bus.", "हर रूट पहले से इस बस में है।"),
  doneAdding: p("Done adding routes", "रूट जोड़ना पूरा"),
  stopTime: p("Time (optional)", "समय (ज़रूरी नहीं)"),
  moveUp: (name: string) => p(`Move ${name} up`, `${name} को ऊपर करें`),
  moveDown: (name: string) => p(`Move ${name} down`, `${name} को नीचे करें`),
  removeStop: (name: string) => p(`Take ${name} off this bus`, `${name} को इस बस से हटाएँ`),
  carriesLive: (n: number) => p(`This bus carries ${n} ${n === 1 ? "child" : "children"}`, `इस बस में ${n} बच्चे जाएँगे`),
  notes: p("Anything else (optional)", "और कुछ (ज़रूरी नहीं)"),
  notesHint: p("Type or tap the microphone and speak.", "लिखें, या माइक दबाकर बोलें।"),
  notesExample: p("For example: waits 5 minutes at the temple stop", "जैसे: मंदिर वाले स्टॉप पर 5 मिनट रुकती है"),
  saveBus: p("Save bus", "बस सहेजें"),
  savedBus: p("Bus saved", "बस सहेजी गई"),
  removeBus: p("Remove this bus", "यह बस हटाएँ"),
  removeBusQ: p("Remove this bus?", "यह बस हटाएँ?"),
  removeBusBody: p("Its time, driver and routes are removed. The children stay on their routes.", "इसका समय, ड्राइवर और रूट हट जाएँगे। बच्चे अपने रूट पर बने रहेंगे।"),
  removedBus: p("Bus removed", "बस हटाई गई"),
  cancel: p("Cancel", "रद्द करें"),
  remove: p("Remove", "हटाएँ"),
  fixAbove: p("Please fix the boxes marked in red.", "लाल निशान वाले खाने ठीक करें।"),
  unsure: p("The answer did not come back, so it may have saved.", "जवाब नहीं आया, इसलिए हो सकता है यह सहेजा गया हो।"),
  unsureNext: p("Close this and look at the list before you add it again.", "इसे बंद करें और दोबारा जोड़ने से पहले सूची देख लें।"),

  /* Driver editor */
  addDriverT: p("Add a driver", "ड्राइवर जोड़ें"),
  changeDriver: p("Change driver", "ड्राइवर बदलें"),
  driverName: p("Driver's name", "ड्राइवर का नाम"),
  driverNotes: p("Notes (optional)", "नोट (ज़रूरी नहीं)"),
  driverNotesHint: p("Licence, other number, anything to remember. Type or speak.", "लाइसेंस, दूसरा नंबर, कुछ भी याद रखने को। लिखें या बोलें।"),
  saveDriver: p("Save driver", "ड्राइवर सहेजें"),
  savedDriver: p("Driver saved", "ड्राइवर सहेजा गया"),
  removeDriver: p("Remove this driver", "यह ड्राइवर हटाएँ"),
  removeDriverQ: (name: string) => p(`Remove ${name}?`, `${name} को हटाएँ?`),
  removeDriverBody: (n: number) =>
    n > 0
      ? p(`Their ${n === 1 ? "bus shows" : `${n} buses show`} "No driver yet" until you choose another.`, `उनकी ${n} बस में "अभी ड्राइवर नहीं" दिखेगा, जब तक आप दूसरा न चुनें।`)
      : p("They drive no bus, so nothing else changes.", "वे कोई बस नहीं चलाते, इसलिए और कुछ नहीं बदलेगा।"),
  removedDriver: p("Driver removed", "ड्राइवर हटाया गया"),

  /* Answers from the server */
  answer: {
    not_set_up: p("Bus times and drivers are still being set up. Try again later.", "बस का समय और ड्राइवर अभी तैयार हो रहे हैं। बाद में कोशिश करें।"),
    not_found: p("Someone has removed this already. The list is now up to date.", "इसे किसी ने पहले ही हटा दिया है। सूची अब ताज़ा है।"),
    changed: p("Someone changed this bus while you were editing. Close it, look again and make your change.", "आपके बदलते समय किसी और ने यह बस बदल दी। इसे बंद करें, फिर देखकर बदलाव करें।"),
    driver_missing: p("That driver is no longer on the list. Choose another.", "वह ड्राइवर अब सूची में नहीं है। दूसरा चुनें।"),
    duplicate_stop: p("A route is on this bus twice. Take one off.", "एक रूट इस बस में दो बार है। एक हटाएँ।"),
    bad_request: p("Something in the form was not right. Check it and save again.", "फ़ॉर्म में कुछ ठीक नहीं था। देखकर फिर सहेजें।"),
    failed: p("Could not save just now. Check the internet and try again.", "अभी सहेजा नहीं जा सका। इंटरनेट देखकर फिर कोशिश करें।"),
    denied: p("This account cannot change buses.", "यह खाता बसें नहीं बदल सकता।"),
    preview: p("You are seeing the app as another role. Switch back to make changes.", "आप ऐप को दूसरी भूमिका से देख रहे हैं। बदलाव के लिए वापस आएँ।"),
    session: p("The year was changed in another tab. Reload this page and try again.", "दूसरे टैब में साल बदला गया। यह पेज दोबारा खोलकर फिर कोशिश करें।"),
  },
};

/** The words under a box that was not filled in right. */
export const PROBLEM: Record<Problem, Pair> = {
  required: p("Please fill this in.", "कृपया यह भरें।"),
  time: p("Write the time like 07:05.", "समय ऐसे लिखें: 07:05।"),
  long: p("This is too long.", "यह बहुत लंबा है।"),
  phone: p("A phone number has 10 digits.", "फ़ोन नंबर 10 अंकों का होता है।"),
  no_stops: p("Add at least one route.", "कम से कम एक रूट जोड़ें।"),
  too_many: p("That is too many routes for one bus.", "एक बस के लिए बहुत ज़्यादा रूट हैं।"),
  duplicate: p("A route is on this bus twice.", "एक रूट इस बस में दो बार है।"),
  unknown: p("Choose again from the list.", "सूची से फिर चुनें।"),
  stop_time: p("Write each route's time like 07:15, or leave it empty.", "हर रूट का समय ऐसे लिखें: 07:15, या ख़ाली छोड़ें।"),
};
