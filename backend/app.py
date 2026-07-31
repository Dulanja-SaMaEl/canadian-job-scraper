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
                # Ignore description spans inside
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
    sort_param = request.args.get('sort', 'D') # Default to Date (D) instead of Match (M)
    
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
        # Find all job articles
        articles = soup.find_all('article')
        if not articles:
            # Fallback to divs with result class
            articles = soup.select('div[class*="result"]')
            
        for article in articles:
            job_data = parse_job_article(article)
            if job_data:
                jobs.append(job_data)
                
        # Basic pagination estimation (Job Bank often doesn't give a clear total pages easy to parse,
        # but we can check if a "Next" button exists or if we got results)
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
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        raw_html = response.text
        soup = BeautifulSoup(raw_html, 'html.parser')

        apply_info = []
        seen = set()

        def add(entry):
            if entry and entry not in seen:
                seen.add(entry)
                apply_info.append(entry)

        # ── 1. Real mailto: links (skip template ones like mailto:?Subject=)
        for a in soup.find_all('a', href=True):
            href = a['href']
            if href.startswith('mailto:') and not href.startswith('mailto:?'):
                email = href.replace('mailto:', '').split('?')[0].strip()
                if email and '@' in email and '.' in email:
                    add(f"📧 Email: {email}")

        # ── 2. Regex sweep on raw HTML for emails (catches ones inside hidden/collapsed divs)
        raw_emails = re.findall(
            r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}',
            raw_html
        )
        # Blocklist — Job Bank's own domains and image/asset paths
        blocked = {'jobbank.gc.ca', 'canada.ca', 'gc.ca', 'sentry.io',
                   'example.com', 'domain.com', 'email.com'}
        for email in raw_emails:
            domain = email.split('@')[-1].lower()
            if domain not in blocked and not email.endswith(('.png', '.jpg', '.gif', '.svg')):
                add(f"📧 Email: {email}")

        # ── 3. Regex sweep for Canadian phone numbers in raw HTML
        phone_pattern = re.compile(
            r'(?<![\d\-])'          # no digit/dash before
            r'(\+?1[\s\-.]?)?'      # optional country code
            r'\(?\d{3}\)?'          # area code
            r'[\s\-.]'              # separator
            r'\d{3}'                # first 3 digits
            r'[\s\-.]'              # separator
            r'\d{4}'                # last 4 digits
            r'(?![\d])'             # no digit after
        )
        phones_found = set()
        for match in phone_pattern.finditer(raw_html):
            phone = re.sub(r'\s+', ' ', match.group()).strip()
            if phone not in phones_found:
                phones_found.add(phone)
                add(f"📞 Phone: {phone}")

        # ── 4. Structured 'How to apply' section (By mail / In person / By fax)
        how_to_apply_section = soup.find(id='howtoapply')
        if not how_to_apply_section:
            # Search for any collapsed accordion/div that mentions 'how to apply'
            for tag in soup.find_all(True):
                if tag.get('id') and 'apply' in tag.get('id', '').lower():
                    how_to_apply_section = tag
                    break

        if how_to_apply_section:
            for elem in how_to_apply_section.find_all(True):
                text = " ".join(elem.get_text(separator=' ').split())
                for keyword, icon in [
                    ("By mail", "📬"),
                    ("In person", "📬"),
                    ("By fax", "📠"),
                    ("By phone", "📞"),
                    ("By email", "📧"),
                ]:
                    if keyword in text and len(text) < 300:
                        filtered = text
                        if "Show how to apply" not in filtered and "jobbank" not in filtered.lower():
                            add(f"{icon} {filtered}")

        if not apply_info:
            info_string = "ℹ️ No contact info found on this job page. Job Bank may require a login to reveal the employer's details. Click 'Apply' to visit the page directly."
        else:
            info_string = "\n".join(apply_info)

        return jsonify({"applyInfo": info_string})

    except Exception as e:
        print(f"Error fetching job details: {e}")
        return jsonify({"applyInfo": f"Could not load contact info: {str(e)})"})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
