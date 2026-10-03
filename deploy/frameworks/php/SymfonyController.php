<?php
// Symfony: src/Controller/SustainabilityDataController.php
namespace App\Controller;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;

#[AsController]
final class SustainabilityDataController
{
    #[Route('/.well-known/sustainability-data', methods: ['GET', 'HEAD'])]
    public function __invoke(): Response
    {
        return new Response(file_get_contents(__DIR__ . '/../../var/sustainability-data'), 200, [
            'Content-Type' => 'application/sustainability-data+json',
            'X-Content-Type-Options' => 'nosniff',
            'Access-Control-Allow-Origin' => '*',
            'Cache-Control' => 'public, max-age=86400',
        ]);
    }
}
