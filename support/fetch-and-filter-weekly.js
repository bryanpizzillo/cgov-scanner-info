/**
 * @file This is a script that fetches the current json file from the digital.gov site scanning program.
 * This is meant to be used in some sort of CI/CD process prior to running the dev script, or
 * publishing the app. This should be able to be done in GH actions too, and could result
 * in a nice tool publishing out to github pages as part of a weekly build.
 */

import got from 'got';


const DATA_URL = 'https://api.gsa.gov/technology/site-scanning/data/weekly-snapshot.json';

const fetchFileFromFile = async () => {
	const data = await import('../weekly-snapshot.json', {
		assert: { type: 'json' }
	});
	return data.default;
};

const fetchFileFromWeb = async () => {
	let data = [];
	// Step 1. Download the file
	try {
		data = (await got.get(DATA_URL)).data;
	} catch (err) {
		console.log(err);
		process.exit(1);
	}
};

const filterData = async (data) => {
	//return data.filter((site) => site.final_url_website === 'www.cancer.gov');
	// return data.filter((site) => site.target_url.match(/.*\.(cancer)\.gov$/));
	return data.filter((site) => site.target_url.match(/.*\.(cancer|nci\.nih|smokefree)\.gov$/));
};

const main = async () => {
	// Step 1. Fetch the data
	const data = await fetchFileFromFile();

	// Step 2. Filter the file
	const filteredData = await filterData(data);

	const finalDomains = new Set(filteredData.map(entry => entry.final_url_website));
	const finalDomainsCG = new Set(filteredData.filter(e => e.final_url_domain === 'cancer.gov').map(entry => entry.final_url_website));
	const finalDomainsSF = new Set(filteredData.filter(e => e.final_url_domain === 'smokefree.gov').map(entry => entry.final_url_website));
	const finalDomainsNC = new Set(filteredData.filter(e => e.final_url_domain === 'nih.gov').map(entry => entry.final_url_website));

	console.log([...(finalDomains.values())].length)
	console.log([...(finalDomainsCG.values())].length);
	console.log([...(finalDomainsSF.values())].length);
	console.log([...(finalDomainsNC.values())].length);
};

main();
