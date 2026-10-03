// Spring Boot 3: one controller. The document is a classpath resource (src/main/resources/sustainability-data).
package example.sustainability;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SustainabilityDataController {
  private static final MediaType TYPE = MediaType.parseMediaType("application/sustainability-data+json");

  @GetMapping("/.well-known/sustainability-data") // Spring answers HEAD for a GET mapping, and 405 with Allow for the rest
  public ResponseEntity<byte[]> declaration() throws IOException {
    byte[] body = new ClassPathResource("sustainability-data").getContentAsByteArray();
    HttpHeaders h = new HttpHeaders();
    h.setContentType(TYPE);
    h.set("X-Content-Type-Options", "nosniff");
    h.setAccessControlAllowOrigin("*");
    h.setCacheControl("public, max-age=86400");
    return new ResponseEntity<>(body, h, HttpStatus.OK);
  }
}
