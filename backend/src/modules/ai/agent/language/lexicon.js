/**
 * Curated phrase lexicon: the words people use to ask a school for the common
 * things (attendance, marks, fees, homework, timetable, notices, leave, PTM,
 * bus, library), in Hindi, Marathi, Gujarati, Tamil, Telugu, Kannada, Bengali
 * and Punjabi, each mapped to the English word the routing readers know.
 *
 * Used for ROUTING ONLY (see language/translate.js): the reply language and the
 * stored transcript keep the person's own words, and names are never in here
 * -- a word the lexicon does not know is transliterated, not translated.
 *
 * Entry format: "form|form|form = english : kind"
 *   kind  n  content word (kept in place)        v  request verb (leads the sentence)
 *         q  question word (leads the sentence)  t  time word (ends the sentence)
 *         d  dropped (copula, particle, "please") s  possessive ("ki", "chi" -> 's)
 *         p  postposition: english is the preposition put BEFORE the phrase ("में" -> in)
 *         y  "yes" said alone                    x  "no" said alone
 *         f  introduces free text ("कि", ":") -- everything after it is kept verbatim
 *         c  class word ("कक्षा" -> class), followed by a grade and a section
 *         z  section letter ("ए" -> A), read only straight after a grade
 *         o  ordinal grade ("छठी" -> 6)
 * english "@kal" is the Hindi/Bengali/Punjabi "kal": yesterday or tomorrow by tense.
 *
 * Every language also carries `suffixes` -- case endings written joined to a
 * word ("राहुलची" = Rahul's in Marathi, "ராகுலின்" in Tamil) -- as
 * [ending, kind, english]. An ending is stripped only when what is left is a
 * known word or at least two letters of a name.
 *
 * Drafted for this product from standard school vocabulary; it should be
 * reviewed by native speakers of each language before a school relies on it
 * for anything beyond routing (it never writes anything a person reads).
 */

function L(lines) {
  const out = [];
  for (const raw of lines) {
    const m = /^(.+?)\s*=\s*(.*?)\s*:\s*([a-z])\s*$/u.exec(raw.trim());
    if (!m) throw new Error(`Bad lexicon line: ${raw}`);
    for (const form of m[1].split('|').map((s) => s.trim()).filter(Boolean)) out.push({ form, en: m[2], kind: m[3] });
  }
  return out;
}

/* Weekdays and months are the same English words in every language below. */
const COMMON_LATIN = [];

export const LEXICON = {
  /* ───────────── Hindi (Devanagari) ───────────── */
  hi: {
    words: L([
      'और|तथा = and : j',
      'नई|नया|नए|नयी|ताज़ा|ताजा = new : n', 'सभी|सब|सारे|सारी = all : n',
      'उपस्थिति|हाजिरी|हाज़िरी|हाजरी|अटेंडेंस|अटेंडेन्स|उपस्थिती = attendance : n',
      'अनुपस्थित|गैरहाजिर|ग़ैरहाज़िर|गैरहाज़िर|ऐबसेंट|एब्सेंट = absent : n',
      'उपस्थित|हाजिर|हाज़िर|प्रेजेंट = present : n',
      'देर से|लेट से|देर|लेट = late : n',
      'अंक|नंबर|मार्क्स|मार्क = marks : n',
      'परिणाम|रिजल्ट|रिज़ल्ट|नतीजा|नतीजे = result : n',
      'रिपोर्ट|रिपोर्ट कार्ड = report card : n',
      'परीक्षा|एग्जाम|एग्ज़ाम|इम्तिहान = exam : n',
      'फीस|फ़ीस|शुल्क = fees : n',
      'बाकी|बकाया|लंबित|बाक़ी|पेंडिंग = pending : n',
      'भुगतान|पेमेंट = payment : n',
      'गृहकार्य|होमवर्क|गृह कार्य = homework : n',
      'असाइनमेंट|कार्य = assignment : n',
      'समय सारणी|समय-सारणी|समयसारणी|टाइमटेबल|टाइम टेबल = timetable : n',
      'पीरियड|कालांश = periods : n',
      'सूचना|सूचनाएं|सूचनाएँ|नोटिस|घोषणा|घोषणाएं|घोषणाएँ|सर्कुलर = notices : n',
      'छुट्टी|छुट्टियां|छुट्टियाँ|अवकाश|लीव = leave : n',
      'अभिभावक शिक्षक बैठक|पैरेंट टीचर मीटिंग|पीटीएम|पी टी एम = parent teacher meeting : n',
      'बैठक|मीटिंग = meeting : n',
      'बस = bus : n',
      'रूट|मार्ग = route : n',
      'परिवहन|ट्रांसपोर्ट = transport : n',
      'स्टॉप|स्टॉपेज = stop : n',
      'पुस्तकालय|लाइब्रेरी = library : n',
      'किताब|किताबें|पुस्तक|पुस्तकें|बुक = book : n',
      'कक्षा|क्लास = class : c',
      'सेक्शन = section : n',
      'छात्र|छात्रों|विद्यार्थी|विद्यार्थियों|स्टूडेंट|स्टूडेंट्स = students : n',
      'बच्चा|बच्चे|बच्चों|बच्ची|बेटा|बेटी|बेटे = child : n',
      'माता-पिता|माता पिता|अभिभावक|अभिभावकों|पेरेंट्स = parents : n',
      'शिक्षक|अध्यापक|टीचर|शिक्षिका|अध्यापिका = teacher : n',
      'विषय = subjects : n',
      'गणित = Mathematics : n', 'विज्ञान = Science : n', 'अंग्रेजी|अंग्रेज़ी|इंग्लिश = English : n', 'हिंदी|हिन्दी = Hindi : n',
      'संदेश|मैसेज = message : n',
      'प्रतिशत|परसेंट = percentage : n',
      'कुल = total : n',
      'आज = today : t', 'कल = @kal : t', 'परसों = day after tomorrow : t',
      'बीता कल|बीते कल = yesterday : t', 'आने वाला कल = tomorrow : t',
      'इस हफ्ते|इस सप्ताह|इस हफ़्ते = this week : t', 'पिछले हफ्ते|पिछले सप्ताह|पिछले हफ़्ते = last week : t', 'अगले हफ्ते|अगले सप्ताह|अगले हफ़्ते = next week : t',
      'इस महीने|इस माह = this month : t', 'पिछले महीने|पिछले माह = last month : t', 'अगले महीने|अगले माह = next month : t',
      'सोमवार = Monday : t', 'मंगलवार = Tuesday : t', 'बुधवार = Wednesday : t', 'गुरुवार|बृहस्पतिवार = Thursday : t', 'शुक्रवार = Friday : t', 'शनिवार = Saturday : t', 'रविवार = Sunday : t',
      'दिखाओ|दिखाइए|दिखाइये|दिखाएं|दिखाएँ|दिखा दो|दिखाना|दिखा = show : v',
      'बताओ|बताइए|बताइये|बताएं|बताएँ|बता दो|बताना|बता = tell me : v',
      'मार्क करो|मार्क करें|मार्क कर दो|दर्ज करो|दर्ज करें|लगाओ|लगा दो = mark : v',
      'आवेदन करो|आवेदन करें|आवेदन करना है|अप्लाई करो|अप्लाई करें = apply for : v',
      'भेजो|भेजें|भेज दो|भेजिए|भेजना = send : v',
      'बुक करो|बुक करें|बुक कर दो = book : v',
      'रद्द करो|रद्द करें|कैंसल करो = cancel : v',
      'जारी करो|जारी करें|इशू करो = issue : v',
      'कौन|किसने|किसकी = who : q',
      'कितना|कितनी|कितने = how much : q',
      'कब = when : q', 'कहाँ|कहां = where : q',
      'कौन सा|कौनसा|कौन सी|कौनसी|कौन से|कौनसे = which : q',
      'कैसी|कैसा|कैसे = how is : q',
      'क्या = what : q',
      'मेरा|मेरी|मेरे|अपना|अपनी|अपने|हमारा|हमारी|हमारे = my : n',
      'उसका|उसकी|उसके = his : n',
      'में = in : p', 'के लिए|लिए = for : p', 'को = to : p', 'से = from : p', 'पर = on : p',
      'का|की|के = \'s : s',
      'है|हैं|था|थी|थे|हो|जी|भी|तो|कृपया|प्लीज़|प्लीज|ज़रा|जरा|हुआ|हुई|रहा|रही|गया|गई|आया|आई|करो|करें|कर|ना|मुझे|मुझको|हमें|चाहिए|जानकारी = : d',
      'छुट्टी चाहिए|छुट्टी लेनी है|छुट्टी के लिए आवेदन|छुट्टी के लिए आवेदन करना है|छुट्टी के लिए अप्लाई करो = apply for leave : v',
      'नहीं आया|नहीं आई|नहीं आए|नहीं आये = absent : n',
      'हाँ|हां|जी हाँ|ठीक है|हाँ जी = yes : y', 'नहीं|ना जी|मत करो = no : x',
      'कि|कहो कि|लिखो कि = saying : f', 'क्योंकि|कारण = because : f',
      'ए = A : z', 'बी = B : z', 'सी = C : z', 'डी = D : z',
      'पहली|पहला = 1 : o', 'दूसरी|दूसरा = 2 : o', 'तीसरी|तीसरा = 3 : o', 'चौथी|चौथा = 4 : o', 'पांचवीं|पाँचवीं|पांचवी|पाँचवी = 5 : o', 'छठी|छठवीं|छठा = 6 : o',
      'सातवीं|सातवी = 7 : o', 'आठवीं|आठवी = 8 : o', 'नौवीं|नौवी|नवीं = 9 : o', 'दसवीं|दसवी = 10 : o', 'ग्यारहवीं = 11 : o', 'बारहवीं = 12 : o',
    ]),
    suffixes: [['ों', 'n', ''], ['ें', 'n', '']],
  },

  /* ───────────── Marathi (Devanagari) ───────────── */
  mr: {
    words: L([
      'आणि|व = and : j',
      'नवीन|नवे|नवी = new : n', 'सर्व|सगळे|सगळ्या = all : n', 'रजे = leave : n', 'ग्रंथालया = library : n',
      'उपस्थिती|हजेरी|हजेरीची|अटेंडन्स = attendance : n',
      'गैरहजर|अनुपस्थित|गैरहजेरी = absent : n',
      'हजर|उपस्थित = present : n',
      'उशीरा|उशिरा = late : n',
      'गुण|मार्क्स|मार्क = marks : n',
      'निकाल|रिझल्ट = result : n',
      'प्रगतीपुस्तक|रिपोर्ट कार्ड = report card : n',
      'परीक्षा = exam : n',
      'फी|फी चे|शुल्क = fees : n',
      'बाकी|थकबाकी|प्रलंबित = pending : n',
      'गृहपाठ|होमवर्क|गृहकार्य = homework : n',
      'वेळापत्रक|टाइमटेबल = timetable : n',
      'तासिका = periods : n',
      'सूचना|नोटीस|नोटिस|घोषणा|परिपत्रक = notices : n',
      'रजा|सुट्टी|सुटी = leave : n',
      'पालक सभा|पालक शिक्षक सभा|पालक-शिक्षक सभा|पीटीएम = parent teacher meeting : n',
      'सभा|बैठक|मीटिंग = meeting : n',
      'बस = bus : n', 'मार्ग|रूट = route : n', 'वाहतूक = transport : n', 'थांबा = stop : n',
      'ग्रंथालय|वाचनालय|लायब्ररी = library : n',
      'पुस्तक|पुस्तके|पुस्तकं = book : n',
      'वर्ग|इयत्ता|क्लास = class : c',
      'तुकडी = section : n',
      'विद्यार्थी|विद्यार्थ्यांची|विद्यार्थ्यांना|विद्यार्थ्यांचे = students : n',
      'मुलगा|मुलगी|मूल|मुला|मुली|मुलां = child : n',
      'पालक|पालकांना = parents : n',
      'शिक्षक|शिक्षिका = teacher : n',
      'विषय = subjects : n',
      'गणित = Mathematics : n', 'विज्ञान = Science : n', 'इंग्रजी = English : n', 'हिंदी = Hindi : n', 'मराठी = Marathi : n',
      'संदेश|मेसेज = message : n',
      'टक्केवारी|टक्के = percentage : n',
      'आज|आजची|आजचा|आजचे = today : t', 'काल|कालची|कालचा|कालचे = yesterday : t', 'उद्या|उद्याची|उद्याचा|उद्याचे = tomorrow : t',
      'या आठवड्यात|या आठवड्याचे = this week : t', 'मागील आठवड्यात|मागच्या आठवड्यात = last week : t', 'पुढील आठवड्यात|पुढच्या आठवड्यात = next week : t',
      'या महिन्यात|या महिन्याची|या महिन्याचे = this month : t', 'मागील महिन्यात|मागच्या महिन्यात|गेल्या महिन्यात = last month : t',
      'सोमवार = Monday : t', 'मंगळवार = Tuesday : t', 'बुधवार = Wednesday : t', 'गुरुवार = Thursday : t', 'शुक्रवार = Friday : t', 'शनिवार = Saturday : t', 'रविवार = Sunday : t',
      'दाखवा|दाखव|दाखवा ना|दाखवून द्या = show : v',
      'सांगा|सांग|सांगा ना = tell me : v',
      'नोंदवा|नोंद करा|मार्क करा = mark : v',
      'अर्ज करा|अर्ज करायचा आहे = apply for : v',
      'रजा हवी आहे|रजा पाहिजे|सुट्टी हवी आहे|सुट्टी पाहिजे|रजेसाठी अर्ज करा = apply for leave : v',
      'पाठवा|पाठव = send : v',
      'बुक करा = book : v', 'रद्द करा = cancel : v',
      'कोण|कोणी = who : q', 'किती = how much : q', 'कधी = when : q', 'कुठे = where : q',
      'कोणता|कोणती|कोणते = which : q', 'कशी|कसा|कसे = how is : q', 'काय = what : q',
      'माझा|माझी|माझे|माझ्या|आमचा|आमची|आमचे|आमच्या = my : n',
      'मध्ये = in : p', 'साठी = for : p', 'ला = to : p', 'कडून = from : p',
      'चा|ची|चे|च्या = \'s : s',
      'आहे|आहेत|होता|होती|होते|ना|कृपया|जरा|करा|द्या|मला|आम्हाला|हवी|पाहिजे|माहिती = : d',
      'आला नाही|आली नाही|आले नाहीत = absent : n',
      'हो|होय|ठीक आहे|चालेल = yes : y', 'नाही|नको = no : x',
      'की = saying : f', 'कारण|कारण की = because : f',
      'ए = A : z', 'बी = B : z', 'सी = C : z', 'डी = D : z',
      'पहिली = 1 : o', 'दुसरी = 2 : o', 'तिसरी = 3 : o', 'चौथी = 4 : o', 'पाचवी = 5 : o', 'सहावी = 6 : o', 'सातवी = 7 : o', 'आठवी = 8 : o', 'नववी = 9 : o', 'दहावी = 10 : o', 'अकरावी = 11 : o', 'बारावी = 12 : o',
    ]),
    suffixes: [['च्या', 's', "'s"], ['ची', 's', "'s"], ['चा', 's', "'s"], ['चे', 's', "'s"], ['मध्ये', 'p', 'in'], ['साठी', 'p', 'for'], ['ला', 'p', 'to'], ['त', 'p', 'in']],
  },

  /* ───────────── Gujarati ───────────── */
  gu: {
    words: L([
      'અને = and : j',
      'નવી|નવું|નવા = new : n', 'બધી|બધા|બધું = all : n', 'સૂચનાઓ|જાહેરાતો = notices : n',
      'હાજરી|ઉપસ્થિતિ|અટેન્ડન્સ = attendance : n',
      'ગેરહાજર|અનુપસ્થિત = absent : n', 'હાજર|ઉપસ્થિત = present : n', 'મોડા|મોડું = late : n',
      'ગુણ|માર્ક્સ|માર્ક = marks : n', 'પરિણામ|રિઝલ્ટ = result : n', 'પરીક્ષા = exam : n',
      'ફી|ફીસ|શુલ્ક = fees : n', 'બાકી|બાકીની|બાકીનું = pending : n',
      'ગૃહકાર્ય|હોમવર્ક|લેસન = homework : n',
      'સમયપત્રક|ટાઈમટેબલ|ટાઇમટેબલ = timetable : n',
      'સૂચના|નોટિસ|જાહેરાત|પરિપત્ર = notices : n',
      'રજા = leave : n',
      'વાલી મીટિંગ|વાલી સભા|પીટીએમ = parent teacher meeting : n', 'મીટિંગ|સભા = meeting : n',
      'બસ = bus : n', 'રૂટ|માર્ગ = route : n', 'પરિવહન = transport : n',
      'પુસ્તકાલય|લાઇબ્રેરી|લાયબ્રેરી = library : n', 'પુસ્તક|પુસ્તકો|ચોપડી = book : n',
      'વર્ગ|ધોરણ|ક્લાસ = class : c',
      'વિદ્યાર્થી|વિદ્યાર્થીઓ = students : n',
      'બાળક|દીકરો|દીકરી|દીકરા = child : n',
      'વાલી|માતાપિતા|માતા-પિતા = parents : n', 'શિક્ષક|શિક્ષિકા = teacher : n', 'વિષય|વિષયો = subjects : n',
      'ગણિત = Mathematics : n', 'વિજ્ઞાન = Science : n', 'અંગ્રેજી = English : n', 'ગુજરાતી = Gujarati : n',
      'સંદેશ|મેસેજ = message : n',
      'આજે|આજ|આજની|આજનું = today : t', 'ગઈકાલે|ગઈ કાલે|ગઈકાલની = yesterday : t', 'આવતીકાલે|આવતી કાલે|કાલે|આવતીકાલનું = tomorrow : t',
      'આ અઠવાડિયે = this week : t', 'ગયા અઠવાડિયે = last week : t', 'આ મહિને|આ મહિનાની = this month : t', 'ગયા મહિને|ગયા મહિનાની = last month : t',
      'સોમવાર = Monday : t', 'મંગળવાર = Tuesday : t', 'બુધવાર = Wednesday : t', 'ગુરુવાર = Thursday : t', 'શુક્રવાર = Friday : t', 'શનિવાર = Saturday : t', 'રવિવાર = Sunday : t',
      'બતાવો|બતાવ|દેખાડો = show : v', 'કહો|જણાવો|કહે = tell me : v',
      'નોંધો|માર્ક કરો = mark : v', 'અરજી કરો = apply for : v', 'રજા જોઈએ છે|રજા જોઈએ|રજા માટે અરજી કરો = apply for leave : v', 'મોકલો|મોકલ = send : v', 'બુક કરો = book : v', 'રદ કરો = cancel : v',
      'કોણ = who : q', 'કેટલી|કેટલું|કેટલા = how much : q', 'ક્યારે = when : q', 'ક્યાં = where : q', 'કયું|કઈ|કયા = which : q', 'કેવી|કેવું|કેવો = how is : q', 'શું = what : q',
      'મારું|મારી|મારા|મારો|અમારું|અમારી|અમારા = my : n',
      'માં = in : p', 'માટે = for : p', 'ને = to : p', 'થી = from : p',
      'નો|ની|નું|ના = \'s : s',
      'છે|હતું|હતી|હતા|કૃપા કરીને|જરા|કરો|મને|જોઈએ = : d',
      'હા|હાં|બરાબર|ઠીક છે = yes : y', 'ના|નહીં = no : x',
      'કે = saying : f', 'કારણ કે = because : f',
      'એ = A : z', 'બી = B : z', 'સી = C : z', 'ડી = D : z',
    ]),
    suffixes: [['ની', 's', "'s"], ['નો', 's', "'s"], ['નું', 's', "'s"], ['ના', 's', "'s"], ['માં', 'p', 'in'], ['ને', 'p', 'to'], ['થી', 'p', 'from']],
  },

  /* ───────────── Tamil ───────────── */
  ta: {
    words: L([
      'மற்றும் = and : j',
      'இல் = in : p', 'க்கு|உக்கு = for : p',
      'புதிய = new : n', 'அனைத்து|எல்லா = all : n', 'நூலக = library : n',
      'வருகை|வருகைப்பதிவு|வருகைப் பதிவு|அட்டெண்டன்ஸ்|வருகையை|வருகைப்பதிவை = attendance : n',
      'வராத|வரவில்லை|வராதவர்கள்|விடுப்பில் = absent : n', 'வந்த|வந்தவர்கள்|ஆஜர் = present : n', 'தாமதம்|லேட் = late : n',
      'மதிப்பெண்|மதிப்பெண்கள்|மதிப்பெண்களை|மார்க்|மார்க்ஸ் = marks : n', 'முடிவு|முடிவுகள்|ரிசல்ட் = result : n', 'தேர்வு|தேர்வுகள்|பரீட்சை = exam : n',
      'கட்டணம்|கட்டணங்கள்|கட்டணத்தை|ஃபீஸ்|பீஸ் = fees : n', 'நிலுவை|பாக்கி|நிலுவையில் = pending : n',
      'வீட்டுப்பாடம்|வீட்டுப் பாடம்|வீட்டுப்பாடங்கள்|ஹோம்வொர்க் = homework : n',
      'கால அட்டவணை|காலஅட்டவணை|அட்டவணை|டைம்டேபிள் = timetable : n',
      'அறிவிப்பு|அறிவிப்புகள்|அறிவிப்புகளை|நோட்டீஸ்|சுற்றறிக்கை = notices : n',
      'விடுப்பு|விடுமுறை|லீவு|லீவ் = leave : n',
      'பெற்றோர் ஆசிரியர் கூட்டம்|பெற்றோர்-ஆசிரியர் கூட்டம்|பிடிஎம் = parent teacher meeting : n', 'கூட்டம்|சந்திப்பு = meeting : n',
      'பேருந்து|பஸ் = bus : n', 'வழித்தடம்|ரூட் = route : n', 'போக்குவரத்து = transport : n',
      'நூலகம்|லைப்ரரி = library : n', 'புத்தகம்|புத்தகங்கள்|புத்தகங்களை = book : n',
      'வகுப்பு|கிளாஸ் = class : c', 'பிரிவு = section : n',
      'மாணவர்|மாணவர்கள்|மாணவி|மாணவர்களின் = students : n',
      'குழந்தை|மகன்|மகள்|பிள்ளை|என் மகன்|என் மகள் = child : n',
      'பெற்றோர்|பெற்றோருக்கு = parents : n', 'ஆசிரியர்|ஆசிரியை = teacher : n', 'பாடம்|பாடங்கள் = subjects : n',
      'கணிதம்|கணக்கு = Mathematics : n', 'அறிவியல் = Science : n', 'ஆங்கிலம் = English : n', 'தமிழ் = Tamil : n',
      'செய்தி|மெசேஜ் = message : n',
      'இன்று|இன்னைக்கு|இன்றைய = today : t', 'நேற்று|நேத்து|நேற்றைய = yesterday : t', 'நாளை|நாளைக்கு|நாளைய = tomorrow : t',
      'இந்த வாரம்|இந்த வாரத்தின் = this week : t', 'கடந்த வாரம்|போன வாரம் = last week : t', 'இந்த மாதம்|இந்த மாதத்தின் = this month : t', 'கடந்த மாதம்|போன மாதம் = last month : t',
      'திங்கள்|திங்கட்கிழமை = Monday : t', 'செவ்வாய்|செவ்வாய்க்கிழமை = Tuesday : t', 'புதன்|புதன்கிழமை = Wednesday : t', 'வியாழன்|வியாழக்கிழமை = Thursday : t', 'வெள்ளி|வெள்ளிக்கிழமை = Friday : t', 'சனி|சனிக்கிழமை = Saturday : t', 'ஞாயிறு|ஞாயிற்றுக்கிழமை = Sunday : t',
      'காட்டு|காட்டுங்கள்|காட்டவும்|காண்பி|காண்பிக்கவும் = show : v', 'சொல்லு|சொல்லுங்கள்|சொல்லவும்|கூறு|கூறுங்கள் = tell me : v',
      'பதிவு செய்|பதிவு செய்யவும்|குறி|குறிக்கவும் = mark : v', 'விண்ணப்பி|விண்ணப்பிக்கவும்|விண்ணப்பம் = apply for : v', 'விடுப்பு வேண்டும்|லீவு வேண்டும்|விடுப்புக்கு விண்ணப்பி = apply for leave : v', 'அனுப்பு|அனுப்புங்கள்|அனுப்பவும் = send : v', 'முன்பதிவு செய் = book : v', 'ரத்து செய் = cancel : v',
      'யார் = who : q', 'எவ்வளவு|எத்தனை = how much : q', 'எப்போது|எப்ப = when : q', 'எங்கே = where : q', 'எந்த = which : q', 'எப்படி = how is : q', 'என்ன = what : q',
      'என்|என்னுடைய|எங்கள்|எனது = my : n',
      'உள்ளது|இருக்கிறது|இருக்கு|உள்ளன|தயவுசெய்து|தயவு செய்து|ஆகும்|எனக்கு|வேண்டும் = : d',
      'ஆம்|ஆமாம்|சரி = yes : y', 'இல்லை|வேண்டாம் = no : x',
      'என்று = saying : f',
      'ஏ = A : z', 'பி = B : z', 'சி = C : z', 'டி = D : z',
    ]),
    suffixes: [['இன்', 's', "'s"], ['ின்', 's', "'s"], ['உடைய', 's', "'s"], ['ுடைய', 's', "'s"], ['இல்', 'p', 'in'], ['ில்', 'p', 'in'], ['க்கு', 'p', 'for'], ['ுக்கு', 'p', 'for'], ['ஐ', 'd', ''], ['ை', 'd', '']],
  },

  /* ───────────── Telugu ───────────── */
  te: {
    words: L([
      'మరియు = and : j',
      'లో = in : p', 'కోసం = for : p', 'కి|కు = to : p',
      'కొత్త = new : n', 'అన్ని = all : n', 'రేపటి = tomorrow : t', 'ఈరోజు యొక్క|నేటి = today : t',
      'హాజరు|అటెండెన్స్|హాజరును = attendance : n',
      'గైర్హాజరు|రాలేదు|హాజరుకాని|గైర్హాజరైన = absent : n', 'హాజరైన|వచ్చిన = present : n', 'ఆలస్యం|లేట్ = late : n',
      'మార్కులు|మార్కుల|మార్క్స్ = marks : n', 'ఫలితాలు|ఫలితం|రిజల్ట్ = result : n', 'పరీక్ష|పరీక్షలు = exam : n',
      'ఫీజు|ఫీజులు|రుసుము = fees : n', 'బకాయి|పెండింగ్|బాకీ = pending : n',
      'హోంవర్క్|హోమ్‌వర్క్|ఇంటిపని|ఇంటి పని = homework : n',
      'టైమ్‌టేబుల్|టైంటేబుల్|టైమ్ టేబుల్|సమయ పట్టిక|కాలపట్టిక = timetable : n',
      'నోటీసు|నోటీసులు|ప్రకటన|ప్రకటనలు|సర్క్యులర్ = notices : n',
      'సెలవు|సెలవులు|లీవ్ = leave : n',
      'తల్లిదండ్రుల సమావేశం|పేరెంట్ టీచర్ మీటింగ్|పీటీఎం = parent teacher meeting : n', 'సమావేశం|మీటింగ్ = meeting : n',
      'బస్సు|బస్ = bus : n', 'రూట్|మార్గం = route : n', 'రవాణా = transport : n',
      'గ్రంథాలయం|లైబ్రరీ = library : n', 'పుస్తకం|పుస్తకాలు = book : n',
      'తరగతి|క్లాస్ = class : c', 'సెక్షన్ = section : n',
      'విద్యార్థి|విద్యార్థులు|విద్యార్థుల = students : n',
      'పిల్లలు|పిల్లల|అబ్బాయి|అమ్మాయి|కొడుకు|కూతురు|బిడ్డ = child : n',
      'తల్లిదండ్రులు|తల్లిదండ్రులకు = parents : n', 'ఉపాధ్యాయుడు|ఉపాధ్యాయురాలు|టీచర్ = teacher : n', 'సబ్జెక్టులు|విషయాలు = subjects : n',
      'గణితం|లెక్కలు = Mathematics : n', 'సైన్స్|విజ్ఞానం = Science : n', 'ఇంగ్లీష్|ఆంగ్లం = English : n', 'తెలుగు = Telugu : n',
      'సందేశం|మెసేజ్ = message : n',
      'ఈరోజు|ఈ రోజు|నేడు|ఇవాళ = today : t', 'నిన్న = yesterday : t', 'రేపు = tomorrow : t',
      'ఈ వారం = this week : t', 'గత వారం|పోయిన వారం = last week : t', 'ఈ నెల = this month : t', 'గత నెల|పోయిన నెల = last month : t',
      'సోమవారం = Monday : t', 'మంగళవారం = Tuesday : t', 'బుధవారం = Wednesday : t', 'గురువారం = Thursday : t', 'శుక్రవారం = Friday : t', 'శనివారం = Saturday : t', 'ఆదివారం = Sunday : t',
      'చూపించు|చూపించండి|చూపు|చూపండి = show : v', 'చెప్పు|చెప్పండి = tell me : v',
      'నమోదు చేయి|నమోదు చేయండి|మార్క్ చేయి|మార్క్ చేయండి = mark : v', 'దరఖాస్తు చేయి|దరఖాస్తు చేయండి = apply for : v', 'సెలవు కావాలి|సెలవుకు దరఖాస్తు చేయండి = apply for leave : v', 'పంపు|పంపండి = send : v', 'బుక్ చేయండి = book : v', 'రద్దు చేయండి = cancel : v',
      'ఎవరు = who : q', 'ఎంత|ఎన్ని = how much : q', 'ఎప్పుడు = when : q', 'ఎక్కడ = where : q', 'ఏ = which : q', 'ఎలా|ఎలా ఉంది = how is : q', 'ఏమిటి|ఏంటి = what : q',
      'నా|మా = my : n',
      'యొక్క = \'s : s',
      'ఉంది|ఉన్నాయి|దయచేసి|కూడా|నాకు|కావాలి = : d',
      'అవును|సరే = yes : y', 'కాదు|వద్దు|లేదు = no : x',
      'అని = saying : f',
      'ఎ = A : z', 'బి = B : z', 'సి = C : z', 'డి = D : z',
    ]),
    suffixes: [['యొక్క', 's', "'s"], ['లో', 'p', 'in'], ['కి', 'p', 'for'], ['కు', 'p', 'for'], ['ని', 'd', ''], ['ను', 'd', '']],
  },

  /* ───────────── Kannada ───────────── */
  kn: {
    words: L([
      'ಮತ್ತು = and : j',
      'ನಲ್ಲಿ|ಅಲ್ಲಿ|ಲ್ಲಿ = in : p', 'ಗಾಗಿ = for : p',
      'ಹೊಸ = new : n', 'ಎಲ್ಲಾ = all : n',
      'ಹಾಜರಾತಿ|ಹಾಜರಿ|ಅಟೆಂಡೆನ್ಸ್ = attendance : n',
      'ಗೈರುಹಾಜರು|ಗೈರು|ಗೈರಾದ|ಬಂದಿಲ್ಲ = absent : n', 'ಹಾಜರು|ಹಾಜರಾದ|ಬಂದ = present : n', 'ತಡ|ಲೇಟ್ = late : n',
      'ಅಂಕಗಳು|ಅಂಕ|ಮಾರ್ಕ್ಸ್ = marks : n', 'ಫಲಿತಾಂಶ|ರಿಸಲ್ಟ್ = result : n', 'ಪರೀಕ್ಷೆ|ಪರೀಕ್ಷೆಗಳು = exam : n',
      'ಶುಲ್ಕ|ಫೀಸ್|ಫೀ = fees : n', 'ಬಾಕಿ|ಬಾಕಿಯಿರುವ = pending : n',
      'ಮನೆಗೆಲಸ|ಹೋಮ್‌ವರ್ಕ್|ಹೋಮ್ ವರ್ಕ್ = homework : n',
      'ವೇಳಾಪಟ್ಟಿ|ಟೈಮ್‌ಟೇಬಲ್|ಟೈಮ್ ಟೇಬಲ್ = timetable : n',
      'ಸೂಚನೆ|ಸೂಚನೆಗಳು|ಪ್ರಕಟಣೆ|ಪ್ರಕಟಣೆಗಳು|ನೋಟಿಸ್ = notices : n',
      'ರಜೆ|ಲೀವ್ = leave : n',
      'ಪೋಷಕರ ಸಭೆ|ಪೋಷಕ ಶಿಕ್ಷಕರ ಸಭೆ|ಪಿಟಿಎಂ = parent teacher meeting : n', 'ಸಭೆ|ಮೀಟಿಂಗ್ = meeting : n',
      'ಬಸ್ = bus : n', 'ಮಾರ್ಗ|ರೂಟ್ = route : n', 'ಸಾರಿಗೆ = transport : n',
      'ಗ್ರಂಥಾಲಯ|ಲೈಬ್ರರಿ = library : n', 'ಪುಸ್ತಕ|ಪುಸ್ತಕಗಳು = book : n',
      'ತರಗತಿ|ಕ್ಲಾಸ್ = class : c', 'ವಿಭಾಗ = section : n',
      'ವಿದ್ಯಾರ್ಥಿ|ವಿದ್ಯಾರ್ಥಿಗಳು = students : n',
      'ಮಗು|ಮಗ|ಮಗಳು|ಮಕ್ಕಳು|ಮಗಳ = child : n',
      'ಪೋಷಕರು|ಪೋಷಕರಿಗೆ = parents : n', 'ಶಿಕ್ಷಕ|ಶಿಕ್ಷಕಿ|ಟೀಚರ್ = teacher : n', 'ವಿಷಯಗಳು|ವಿಷಯ = subjects : n',
      'ಗಣಿತ = Mathematics : n', 'ವಿಜ್ಞಾನ = Science : n', 'ಇಂಗ್ಲಿಷ್|ಆಂಗ್ಲ = English : n', 'ಕನ್ನಡ = Kannada : n',
      'ಸಂದೇಶ|ಮೆಸೇಜ್ = message : n',
      'ಇಂದು|ಇವತ್ತು|ಇಂದಿನ = today : t', 'ನಿನ್ನೆ|ನಿನ್ನೆಯ = yesterday : t', 'ನಾಳೆ|ನಾಳೆಯ = tomorrow : t',
      'ಈ ವಾರ = this week : t', 'ಕಳೆದ ವಾರ = last week : t', 'ಈ ತಿಂಗಳು = this month : t', 'ಕಳೆದ ತಿಂಗಳು = last month : t',
      'ಸೋಮವಾರ = Monday : t', 'ಮಂಗಳವಾರ = Tuesday : t', 'ಬುಧವಾರ = Wednesday : t', 'ಗುರುವಾರ = Thursday : t', 'ಶುಕ್ರವಾರ = Friday : t', 'ಶನಿವಾರ = Saturday : t', 'ಭಾನುವಾರ = Sunday : t',
      'ತೋರಿಸು|ತೋರಿಸಿ = show : v', 'ಹೇಳು|ಹೇಳಿ = tell me : v',
      'ದಾಖಲಿಸಿ|ಮಾರ್ಕ್ ಮಾಡಿ = mark : v', 'ಅರ್ಜಿ ಸಲ್ಲಿಸಿ = apply for : v', 'ರಜೆ ಬೇಕು|ರಜೆಗೆ ಅರ್ಜಿ ಸಲ್ಲಿಸಿ = apply for leave : v', 'ಕಳುಹಿಸು|ಕಳುಹಿಸಿ = send : v', 'ಬುಕ್ ಮಾಡಿ = book : v', 'ರದ್ದುಮಾಡಿ|ರದ್ದು ಮಾಡಿ = cancel : v',
      'ಯಾರು = who : q', 'ಎಷ್ಟು = how much : q', 'ಯಾವಾಗ = when : q', 'ಎಲ್ಲಿ = where : q', 'ಯಾವ = which : q', 'ಹೇಗಿದೆ|ಹೇಗೆ = how is : q', 'ಏನು = what : q',
      'ನನ್ನ|ನಮ್ಮ = my : n',
      'ಇದೆ|ಇವೆ|ದಯವಿಟ್ಟು|ನನಗೆ|ಬೇಕು = : d',
      'ಹೌದು|ಸರಿ = yes : y', 'ಇಲ್ಲ|ಬೇಡ = no : x',
      'ಎಂದು = saying : f',
      'ಎ = A : z', 'ಬಿ = B : z', 'ಸಿ = C : z', 'ಡಿ = D : z',
    ]),
    suffixes: [['ಅವರ', 's', "'s"], ['ರ', 's', "'s"], ['ನ', 's', "'s"], ['ಲ್ಲಿ', 'p', 'in'], ['ಗೆ', 'p', 'for'], ['ಕ್ಕೆ', 'p', 'for'], ['ನ್ನು', 'd', '']],
  },

  /* ───────────── Bengali ───────────── */
  bn: {
    words: L([
      'এবং|আর = and : j',
      'তে = in : p', 'জন্য = for : p',
      'নতুন = new : n', 'সব|সকল = all : n',
      'উপস্থিতি|হাজিরা|অ্যাটেনডেন্স = attendance : n',
      'অনুপস্থিত|গরহাজির|আসেনি = absent : n', 'উপস্থিত|হাজির = present : n', 'দেরি|লেট = late : n',
      'নম্বর|মার্কস|মার্ক = marks : n', 'ফলাফল|রেজাল্ট = result : n', 'পরীক্ষা = exam : n',
      'ফি|ফিস|বেতন|মাইনে = fees : n', 'বাকি|বকেয়া = pending : n',
      'বাড়ির কাজ|হোমওয়ার্ক = homework : n',
      'সময়সূচি|সময়সূচী|রুটিন|টাইমটেবিল = timetable : n',
      'নোটিশ|বিজ্ঞপ্তি|ঘোষণা = notices : n',
      'ছুটি = leave : n',
      'অভিভাবক সভা|অভিভাবক-শিক্ষক সভা|পিটিএম = parent teacher meeting : n', 'সভা|মিটিং = meeting : n',
      'বাস = bus : n', 'রুট = route : n', 'পরিবহন = transport : n',
      'লাইব্রেরি|গ্রন্থাগার|পাঠাগার = library : n', 'বই|বইগুলো = book : n',
      'ক্লাস|শ্রেণী|শ্রেণি = class : c', 'সেকশন|বিভাগ = section : n',
      'ছাত্র|ছাত্রী|ছাত্রছাত্রী|শিক্ষার্থী = students : n',
      'ছেলে|মেয়ে|সন্তান|বাচ্চা = child : n',
      'অভিভাবক|বাবা-মা = parents : n', 'শিক্ষক|শিক্ষিকা = teacher : n', 'বিষয়|বিষয়গুলো = subjects : n',
      'গণিত|অঙ্ক = Mathematics : n', 'বিজ্ঞান = Science : n', 'ইংরেজি = English : n', 'বাংলা = Bengali : n',
      'বার্তা|মেসেজ = message : n',
      'আজ|আজকে|আজকের = today : t', 'গতকাল|গতকালের = yesterday : t', 'আগামীকাল|আগামীকালের = tomorrow : t', 'কাল|কালকে|কালকের = @kal : t',
      'এই সপ্তাহে = this week : t', 'গত সপ্তাহে = last week : t', 'এই মাসে|এই মাসের = this month : t', 'গত মাসে|গত মাসের = last month : t',
      'সোমবার = Monday : t', 'মঙ্গলবার = Tuesday : t', 'বুধবার = Wednesday : t', 'বৃহস্পতিবার = Thursday : t', 'শুক্রবার = Friday : t', 'শনিবার = Saturday : t', 'রবিবার = Sunday : t',
      'দেখাও|দেখান|দেখাবেন = show : v', 'বলো|বলুন|বলবেন = tell me : v',
      'চিহ্নিত করুন|মার্ক করুন = mark : v', 'আবেদন করো|আবেদন করুন = apply for : v', 'ছুটি চাই|ছুটির আবেদন করুন = apply for leave : v', 'পাঠাও|পাঠান = send : v', 'বুক করুন = book : v', 'বাতিল করুন = cancel : v',
      'কে|কারা = who : q', 'কত = how much : q', 'কখন = when : q', 'কোথায় = where : q', 'কোন = which : q', 'কেমন = how is : q', 'কী|কি = what : q',
      'আমার|আমাদের = my : n',
      'আছে|ছিল|দয়া করে|অনুগ্রহ করে|হয়েছে|আমি|চাই = : d',
      'হ্যাঁ|হাঁ|ঠিক আছে = yes : y', 'না|নয় = no : x',
      'যে = saying : f', 'কারণ = because : f',
      'এ = A : z', 'বি = B : z', 'সি = C : z', 'ডি = D : z',
    ]),
    suffixes: [['এর', 's', "'s"], ['ের', 's', "'s"], ['র', 's', "'s"], ['তে', 'p', 'in'], ['কে', 'p', 'to']],
  },

  /* ───────────── Punjabi (Gurmukhi) ───────────── */
  pa: {
    words: L([
      'ਅਤੇ|ਤੇ = and : j',
      "ਦੀਆਂ|ਦਿਆਂ = 's : s",
      'ਨਵੇਂ|ਨਵੀਂ|ਨਵਾਂ = new : n', 'ਸਾਰੇ|ਸਾਰੀਆਂ = all : n', 'ਮੇਰੀਆਂ|ਮੇਰਿਆਂ = my : n',
      'ਹਾਜ਼ਰੀ|ਹਾਜਰੀ|ਅਟੈਂਡੈਂਸ = attendance : n',
      'ਗੈਰਹਾਜ਼ਰ|ਗੈਰ ਹਾਜ਼ਰ|ਗੈਰਹਾਜਰ = absent : n', 'ਹਾਜ਼ਰ|ਹਾਜਰ = present : n', 'ਲੇਟ|ਦੇਰ = late : n',
      'ਅੰਕ|ਨੰਬਰ|ਮਾਰਕਸ = marks : n', 'ਨਤੀਜਾ|ਨਤੀਜੇ|ਰਿਜ਼ਲਟ = result : n', 'ਪ੍ਰੀਖਿਆ|ਇਮਤਿਹਾਨ = exam : n',
      'ਫੀਸ = fees : n', 'ਬਕਾਇਆ|ਬਾਕੀ = pending : n',
      'ਹੋਮਵਰਕ|ਘਰ ਦਾ ਕੰਮ = homework : n',
      'ਸਮਾਂ ਸਾਰਣੀ|ਟਾਈਮਟੇਬਲ|ਟਾਈਮ ਟੇਬਲ = timetable : n',
      'ਨੋਟਿਸ|ਸੂਚਨਾ|ਘੋਸ਼ਣਾ = notices : n',
      'ਛੁੱਟੀ|ਛੁੱਟੀਆਂ = leave : n',
      'ਮਾਪੇ ਅਧਿਆਪਕ ਮੀਟਿੰਗ|ਪੀਟੀਐਮ = parent teacher meeting : n', 'ਮੀਟਿੰਗ = meeting : n',
      'ਬੱਸ|ਬਸ = bus : n', 'ਰੂਟ = route : n', 'ਆਵਾਜਾਈ = transport : n',
      'ਲਾਇਬ੍ਰੇਰੀ|ਲਾਇਬ੍ਰੇਰੀ|ਪੁਸਤਕਾਲਾ = library : n', 'ਕਿਤਾਬ|ਕਿਤਾਬਾਂ = book : n',
      'ਜਮਾਤ|ਕਲਾਸ = class : c', 'ਸੈਕਸ਼ਨ = section : n',
      'ਵਿਦਿਆਰਥੀ|ਵਿਦਿਆਰਥੀਆਂ = students : n',
      'ਬੱਚਾ|ਬੱਚੇ|ਬੱਚੀ|ਪੁੱਤਰ|ਧੀ|ਮੁੰਡਾ|ਕੁੜੀ = child : n',
      'ਮਾਪੇ|ਮਾਪਿਆਂ = parents : n', 'ਅਧਿਆਪਕ|ਟੀਚਰ = teacher : n', 'ਵਿਸ਼ੇ = subjects : n',
      'ਗਣਿਤ = Mathematics : n', 'ਵਿਗਿਆਨ = Science : n', 'ਅੰਗਰੇਜ਼ੀ = English : n', 'ਪੰਜਾਬੀ = Punjabi : n',
      'ਸੁਨੇਹਾ|ਮੈਸੇਜ = message : n',
      'ਅੱਜ = today : t', 'ਕੱਲ੍ਹ|ਕੱਲ = @kal : t',
      'ਇਸ ਹਫ਼ਤੇ = this week : t', 'ਪਿਛਲੇ ਹਫ਼ਤੇ = last week : t', 'ਇਸ ਮਹੀਨੇ = this month : t', 'ਪਿਛਲੇ ਮਹੀਨੇ = last month : t',
      'ਸੋਮਵਾਰ = Monday : t', 'ਮੰਗਲਵਾਰ = Tuesday : t', 'ਬੁੱਧਵਾਰ = Wednesday : t', 'ਵੀਰਵਾਰ = Thursday : t', 'ਸ਼ੁੱਕਰਵਾਰ = Friday : t', 'ਸ਼ਨੀਵਾਰ = Saturday : t', 'ਐਤਵਾਰ = Sunday : t',
      'ਦਿਖਾਓ|ਵਿਖਾਓ|ਦਿਖਾ ਦਿਓ = show : v', 'ਦੱਸੋ|ਦੱਸ ਦਿਓ = tell me : v',
      'ਮਾਰਕ ਕਰੋ|ਦਰਜ ਕਰੋ = mark : v', 'ਅਰਜ਼ੀ ਦਿਓ|ਅਪਲਾਈ ਕਰੋ = apply for : v', 'ਛੁੱਟੀ ਚਾਹੀਦੀ ਹੈ|ਛੁੱਟੀ ਚਾਹੀਦੀ|ਛੁੱਟੀ ਲਈ ਅਰਜ਼ੀ ਦਿਓ = apply for leave : v', 'ਭੇਜੋ|ਭੇਜ ਦਿਓ = send : v', 'ਬੁੱਕ ਕਰੋ = book : v', 'ਰੱਦ ਕਰੋ = cancel : v',
      'ਕੌਣ = who : q', 'ਕਿੰਨੀ|ਕਿੰਨਾ|ਕਿੰਨੇ = how much : q', 'ਕਦੋਂ = when : q', 'ਕਿੱਥੇ = where : q', 'ਕਿਹੜਾ|ਕਿਹੜੀ|ਕਿਹੜੇ = which : q', 'ਕਿਵੇਂ|ਕਿਹੋ ਜਿਹੀ = how is : q', 'ਕੀ = what : q',
      'ਮੇਰਾ|ਮੇਰੀ|ਮੇਰੇ|ਸਾਡਾ|ਸਾਡੀ|ਸਾਡੇ = my : n',
      'ਵਿੱਚ|ਵਿਚ = in : p', 'ਲਈ = for : p', 'ਨੂੰ = to : p', 'ਤੋਂ = from : p',
      'ਦਾ|ਦੀ|ਦੇ = \'s : s',
      'ਹੈ|ਹਨ|ਸੀ|ਜੀ|ਵੀ|ਕਿਰਪਾ ਕਰਕੇ|ਜ਼ਰਾ|ਮੈਨੂੰ|ਚਾਹੀਦੀ = : d',
      'ਨਹੀਂ ਆਇਆ|ਨਹੀਂ ਆਈ = absent : n',
      'ਹਾਂ|ਹਾਂ ਜੀ|ਠੀਕ ਹੈ = yes : y', 'ਨਹੀਂ|ਨਾ = no : x',
      'ਕਿ = saying : f', 'ਕਿਉਂਕਿ = because : f',
      'ਏ = A : z', 'ਬੀ = B : z', 'ਸੀ = C : z', 'ਡੀ = D : z',
    ]),
    suffixes: [],
  },
};

void COMMON_LATIN;

/** The languages the lexicon covers. */
export const LEXICON_LANGUAGES = Object.keys(LEXICON);

/* Index: for each language, entries sorted longest form first (so phrases win over their words). */
const INDEX = new Map();
export function entriesFor(lang) {
  if (!INDEX.has(lang)) {
    const lex = LEXICON[lang];
    if (!lex) return null;
    const words = [...lex.words].sort((a, b) => b.form.length - a.form.length);
    const byForm = new Map();
    for (const e of lex.words) if (!byForm.has(e.form)) byForm.set(e.form, e);
    INDEX.set(lang, { words, byForm, phrases: words.filter((e) => /\s/.test(e.form)), suffixes: [...(lex.suffixes ?? [])].sort((a, b) => b[0].length - a[0].length) });
  }
  return INDEX.get(lang);
}

/**
 * Which language's lexicon a text in an Indian script draws on most: Hindi and
 * Marathi share Devanagari, so the script alone cannot tell them apart.
 * Returns { lang, hits } for the best of the candidate languages.
 */
export function bestLexiconLanguage(text, candidates) {
  const s = String(text ?? '');
  const tokens = s.split(/[\s,.?!।|:;"'“”()]+/u).filter(Boolean);
  let best = { lang: candidates[0], hits: -1 };
  for (const lang of candidates) {
    const idx = entriesFor(lang);
    if (!idx) continue;
    let hits = 0;
    for (const tok of tokens) {
      if (idx.byForm.has(tok)) hits += 1;
      else if (idx.suffixes.some(([suf]) => tok.endsWith(suf) && idx.byForm.has(tok.slice(0, -suf.length)))) hits += 0.5;
    }
    for (const p of idx.phrases) if (s.includes(p.form)) hits += 1;
    if (hits > best.hits) best = { lang, hits };
  }
  return best;
}

/* Words that are Marathi and not Hindi: decisive when both lexicons match. */
export const MARATHI_MARKERS = /(?:आहे|आहेत|माझ्या|माझा|माझी|माझे|दाखवा|सांगा|किती|कोण|काय|उद्या|काल|च्या|ची|चा|मध्ये|साठी|नाही|हजेरी|गृहपाठ|वेळापत्रक|रजा|ग्रंथालय)/u;
