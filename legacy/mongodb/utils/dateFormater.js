// date printing code
function convertToUrduNumerals(number) {
    const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return String(number).replace(/\d/g, digit => arabicNumerals[digit]);
}

function date(){
    const currentDate = new Date();


const options = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    era: 'short',
    calendar: 'islamic-umalqura', 
};


const formatter = new Intl.DateTimeFormat('ur-PK', options);


const formattedDate = formatter.format(currentDate);


const urduFormattedDate = formattedDate.replace(/\d/g, digit => convertToUrduNumerals(digit));


const gregorianDate = currentDate.toLocaleDateString('en-US', { year: 'numeric' });


const urduMonthNames = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
const urduMonth = urduMonthNames[currentDate.getMonth()];


const combinedDate = `${urduMonth} ${currentDate.getDate()} ${gregorianDate}`;
return combinedDate
}


export default date;