import time
import re
import requests
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_caching import Cache

app = Flask(__name__)
CORS(app)

# Configure Cache (In-memory, 10-minute TTL)
app.config['CACHE_TYPE'] = 'SimpleCache'
app.config['CACHE_DEFAULT_TIMEOUT'] = 600
cache = Cache(app)

# Headers to prevent blocking
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
}

BASE_URL = "https://www.jobbank.gc.ca/jobsearch/jobsearch"
BASE_DOMAIN = "https://www.jobbank.gc.ca"

def parse_job_article(article):
    """Parse a single job article tag into a dictionary."""
    try:
        # Job ID
        job_id = article.get("data-jobid", "")
        if not job_id and article.get("id"):
            job_id = article.get("id").replace("article-", "")

        # Link
        link_elem = article.select_one("a.resultJobItem, a")
        url = link_elem["href"] if link_elem and link_elem.has_attr("href") else ""
        if url.startswith("/"):
            url = BASE_DOMAIN + url.split(';')[0]  # Remove session ids if any

        # Title
        title_tag = article.select_one(".noctitle")
        if not title_tag:
             title_tag = article.select_one("h3")
        title = title_tag.text.strip() if title_tag else "Unknown Title"

        # Company
        company = "Unknown Company"
        company_elem = article.select_one(".business, .employer-name, .company")
        if company_elem:
            company = company_elem.text.strip()

        # Location
        location = "Unknown Location"
        location_elem = article.select_one(".location")
        if location_elem:
            for hidden in location_elem.find_all("span", class_="wb-inv"):
                hidden.decompose()
            location = " ".join(location_elem.text.split())

        # Salary
        salary = "Not listed"
        salary_elem = article.select_one(".salary, .pay")
        if salary_elem:
            for hidden in salary_elem.find_all("span", class_="wb-inv"):
                hidden.decompose()
            salary = " ".join(salary_elem.text.split()).replace("Salary ", "").replace("Salary", "")

        # Date posted
        date_posted = "Unknown Date"
        date_elem = article.select_one(".date, .date-posted")
        if date_elem:
            date_posted = date_elem.text.strip()

        # Extract flags (like New, On site, Direct Apply)
        flags = []
        flag_container = article.select_one(".flag")
        if flag_container:
            for span in flag_container.find_all("span", recursive=False):
                for desc in span.find_all("span", class_="description"):
                    desc.decompose()
                flag_text = span.text.strip()
                if flag_text:
                    flags.append(flag_text)

        return {
            "jobId": job_id,
            "title": title,
            "company": company,
            "location": location,
            "salary": salary,
            "datePosted": date_posted,
            "url": url,
            "flags": flags
        }
    except Exception as e:
        print(f"Error parsing article: {e}")
        return None

@app.route('/api/jobs', methods=['GET'])
@cache.cached(timeout=600, query_string=True)
def get_jobs():
    keywords = request.args.get('keywords', '')
    page = request.args.get('page', '1')
    sort_param = request.args.get('sort', 'D')  # Default to Date (D)

    # 3-second delay to avoid rate limiting
    time.sleep(3)

    params = {
        "searchstring": keywords,
        "fglo": "1",  # Canadians and international candidates
        "sort": sort_param,
        "page": page
    }

    try:
        response = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        jobs = []
        articles = soup.find_all('article')
        if not articles:
            articles = soup.select('div[class*="result"]')

        for article in articles:
            job_data = parse_job_article(article)
            if job_data:
                jobs.append(job_data)

        total_pages = int(page) + 1 if len(jobs) > 0 else int(page)

        return jsonify({
            "jobs": jobs,
            "totalPages": total_pages,
            "currentPage": int(page),
            "keyword": keywords
        })

    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        return jsonify({"error": "Failed to fetch jobs from Job Bank", "details": str(e)}), 500


@app.route('/api/job-details', methods=['GET'])
@cache.cached(timeout=3600, query_string=True)
def get_job_details():
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "URL is required"}), 400

    try:
        # Retry with increasing timeouts
        response = None
        for timeout in [20, 35]:
            try:
                response = requests.get(url, headers=HEADERS, timeout=timeout)
                response.raise_for_status()
                break
            except requests.exceptions.Timeout:
                if timeout == 35:
                    return jsonify({"applyInfo": "⏱ Job Bank took too long to respond. Click 'Apply' to visit the job page directly."})
                time.sleep(2)

        soup = BeautifulSoup(response.text, 'html.parser')

        apply_info = []
        seen = set()

        def add(entry):
            entry = entry.strip()
            if entry and entry not in seen and len(entry) > 5:
                seen.add(entry)
                apply_info.append(entry)

        # Use get_text() so HTML entities like &#64; are decoded to @
        all_text = soup.get_text(separator=' ')

        # 1. Find emails in decoded text
        blocked_domains = {
            'jobbank.gc.ca', 'canada.ca', 'gc.ca', 'sentry.io',
            'w3.org', 'example.com', 'yourdomain.com', 'forces.ca'
        }
        for email in re.findall(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,4}', all_text):
            domain = email.split('@')[-1].lower()
            if domain not in blocked_domains and not any(email.endswith(x) for x in ['.png', '.jpg', '.gif', '.svg']):
                add(f"📧 Email: {email}")

        # 2. Also scan raw mailto: hrefs (catches obfuscated links)
        for a in soup.find_all('a', href=True):
            href = a['href']
            if href.startswith('mailto:') and not href.startswith('mailto:?'):
                email = href.replace('mailto:', '').split('?')[0].strip()
                if email and '@' in email and '.' in email:
                    add(f"📧 Email: {email}")

        # 3. Find Canadian phone numbers in decoded text
        for phone in re.findall(r'\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}(?!\d)', all_text):
            phone = re.sub(r'\s+', ' ', phone).strip()
            add(f"📞 Phone: {phone}")

        # 4. Look for "By mail", "In person", "By fax" address blocks
        how_to_apply_section = soup.find(id='howtoapply')
        if not how_to_apply_section:
            for tag in soup.find_all(True):
                tag_id = tag.get('id', '')
                if tag_id and 'apply' in tag_id.lower():
                    how_to_apply_section = tag
                    break

        if how_to_apply_section:
            for elem in how_to_apply_section.find_all(True):
                text = " ".join(elem.get_text(separator=' ').split())
                for keyword, icon in [
                    ("By mail", "📬"), ("In person", "📬"),
                    ("By fax", "📠"), ("By phone", "📞"), ("By email", "📧"),
                ]:
                    if keyword in text and 5 < len(text) < 300:
                        if "Show how to apply" not in text and "jobbank" not in text.lower():
                            add(f"{icon} {text}")

        if not apply_info:
            info_string = "ℹ️ Contact info is hidden on this job. Click the blue 'Apply' button, then click the green 'Show how to apply' button on Job Bank to reveal it."
        else:
            info_string = "\n".join(apply_info)

        return jsonify({"applyInfo": info_string})

    except requests.exceptions.Timeout:
        return jsonify({"applyInfo": "⏱ Job Bank took too long to respond. Click 'Apply' to visit the job page directly."})
    except Exception as e:
        print(f"Error fetching job details: {e}")
        return jsonify({"applyInfo": "Could not load contact info. Click 'Apply' to visit the job page."})


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
